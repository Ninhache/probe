import { type ChildProcess, spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import {
  referenced,
  resolveEnv,
  serviceVariables,
  templateParts,
  VARIABLE_NAME,
} from "../config/headers";
import type { Service } from "../config/schema";
import { COMMAND_STDERR_BYTES, COMMAND_STDERR_CHARACTERS, EXIT_DRAIN_MS } from "../constants";
import { currentPlatform, type Platform } from "../platform";
import { truncate } from "../ui/terminal";
import { commandForm } from "./command-form";
import { CONFIG, type Diagnosis, diagnoseUnsendable, diagnoseUnset } from "./diagnosis";
import type { CheckContext, CheckResult, ServiceType } from "./types";

type Command = NonNullable<Service["command"]>;

type Outcome =
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null; stderr: string }
  | { kind: "error"; error: NodeJS.ErrnoException }
  | { kind: "timeout" }
  | { kind: "aborted" };

const WORD_NEEDING_QUOTES = /[\s"'\\]/;
const SAFE_SHELL_WORD = /^[\w@%+=:,./-]+$/;

const quoted = (word: string) => (WORD_NEEDING_QUOTES.test(word) ? JSON.stringify(word) : word);

const shellQuoted = (word: string) =>
  SAFE_SHELL_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

/** What lists and reports show: the command as a person would type it, without running anything. */
export const commandTarget = (command: Command): string =>
  typeof command === "string" ? command : command.map(quoted).join(" ");

/** The command as a POSIX shell runs it: a list is quoted word by word. */
export const shellCommand = (command: Command): string =>
  typeof command === "string" ? command : command.map(shellQuoted).join(" ");

// The reference stays one, written for the shell that runs it: the value is never in the copy.
function shellTemplate(value: string): string {
  return templateParts(value)
    .map(({ text, variable }) =>
      variable !== undefined && VARIABLE_NAME.test(variable)
        ? `"\${${variable}}"`
        : shellQuoted(text ?? ""),
    )
    .join("");
}

/** The command a shell runs, with the env of the service written as references. */
function copiedCommand(service: Service): string {
  const command = service.command as Command;
  const assignments = Object.entries(service.env ?? {}).map(
    ([name, value]) => `${name}=${shellTemplate(value)}`,
  );
  if (assignments.length === 0) return shellCommand(command);
  // `env` reaches the whole string, where a prefix would stop at its first command.
  const run = typeof command === "string" ? `sh -c ${shellQuoted(command)}` : shellCommand(command);
  return `env ${assignments.join(" ")} ${run}`;
}

// probe may get them from `local.yml`, a shell does not.
function copiedNote(service: Service, env: NodeJS.ProcessEnv): string {
  const root = "it runs from the project root";
  const absent = serviceVariables(service).filter((name) => !env[name]);
  if (absent.length === 0) return root;
  const them = absent.length > 1 ? "them" : "it";
  return `${root}; it reads ${absent.join(", ")} from the shell that runs it: export ${them} there first`;
}

const programOf = (command: Command): string =>
  typeof command === "string" ? command : (command[0] as string);

// Masked before it is cut: a secret cut in two would no longer be found.
function lastLine(stderr: string, references: [string, string][]): string | undefined {
  const lines = referenced(stripVTControlCharacters(stderr), references)
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines.at(-1);
  return last === undefined ? undefined : truncate(last, COMMAND_STDERR_CHARACTERS);
}

function run(
  command: Command,
  { timeoutMs, signal, cwd }: Pick<CheckContext, "timeoutMs" | "signal" | "cwd">,
  env: Record<string, string> = {},
  platform: Platform = currentPlatform,
): Promise<Outcome> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ kind: "aborted" });
    const options = {
      cwd,
      // The variables are given to the process, never to its arguments: `ps` would show them.
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"] as ["ignore", "ignore", "pipe"],
      windowsHide: true,
      // Its own process group on POSIX, so the whole tree can be killed at once.
      detached: platform.ownProcessGroup,
    };
    let child: ChildProcess;
    try {
      child =
        typeof command === "string"
          ? spawn(command, { ...options, shell: true })
          : spawn(command[0] as string, command.slice(1), { ...options, shell: false });
    } catch (error) {
      return resolve({ kind: "error", error: error as NodeJS.ErrnoException });
    }

    let tail = Buffer.alloc(0);
    let settled = false;
    let drain: NodeJS.Timeout | undefined;
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      signal?.removeEventListener("abort", onAbort);
      child.stderr?.destroy();
      resolve(outcome);
    };
    const stop = (kind: "timeout" | "aborted") => {
      // A timeout must not leave a server of the command running.
      platform.killTree(child);
      finish({ kind });
    };
    const onAbort = () => stop("aborted");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    // Drained to the end even past the cap: a full pipe would block the command.
    child.stderr?.on("data", (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk]).subarray(-COMMAND_STDERR_BYTES);
    });
    child.on("error", (error) => finish({ kind: "error", error }));
    const done = (code: number | null, signal: NodeJS.Signals | null) =>
      finish({ kind: "exit", code, signal, stderr: tail.toString("utf8") });
    child.on("close", done);
    // A command that left a process behind keeps the pipe open: its own exit is what counts.
    child.on("exit", (code, signal) => {
      if (settled) return;
      drain = setTimeout(() => done(code, signal), EXIT_DRAIN_MS);
    });
  });
}

const CMD_SHIM_HINT =
  'on Windows, npm, pnpm and other .cmd programs need the string form: command: "pnpm test"';

function failure(
  command: Command,
  outcome: Outcome,
  timeoutMs: number,
  references: [string, string][] = [],
  platform: Platform = currentPlatform,
) {
  if (outcome.kind === "timeout") {
    return {
      error: `timeout after ${timeoutMs / 1000}s`,
      hint: `still running, or stuck? Give it more time: \`timeout\` in ${CONFIG}`,
    };
  }
  if (outcome.kind === "aborted") return { error: "aborted" };
  if (outcome.kind === "error") {
    const { code } = outcome.error;
    const program = programOf(command);
    const windows = platform.hasCmdShims && typeof command !== "string";
    if (code === "ENOENT" && typeof command !== "string") {
      return {
        error: `command not found: ${program}`,
        ...(windows ? { hint: CMD_SHIM_HINT } : {}),
      };
    }
    // Node refuses to run a .cmd or .bat without a shell.
    if (code === "EINVAL" && windows)
      return { error: `cannot run: ${program}`, hint: CMD_SHIM_HINT };
    // The message of Node may repeat the command: the code alone is said.
    return { error: code ?? "cannot start" };
  }
  if (outcome.signal) return { error: `killed by ${outcome.signal}` };
  return { error: lastLine(outcome.stderr, references) ?? `exit ${outcome.code}` };
}

export const commandChecker: ServiceType = {
  type: "command",
  target: (service) => commandTarget(service.command as Command),
  copy: (service, env) => ({ command: copiedCommand(service), note: copiedNote(service, env) }),
  form: commandForm,
  async check(name, service, context): Promise<CheckResult> {
    const command = service.command as Command;
    const base = { name, type: "command", target: commandTarget(command) };
    const started = performance.now();
    let env: Record<string, string> = {};
    let references: [string, string][] = [];
    if (service.env) {
      const { variables } = context;
      const resolved = resolveEnv(service.env, variables?.lookup ?? (() => undefined));
      // Nothing runs: a command without its credentials would only say it was refused.
      const failed = (diagnosis: Diagnosis): CheckResult => ({
        ...base,
        ok: false,
        latencyMs: 0,
        ...diagnosis,
      });
      if ("unset" in resolved) return failed(diagnoseUnset(resolved.unset, variables ?? {}));
      if ("unsendable" in resolved) {
        return failed(
          diagnoseUnsendable(resolved.unsendable, variables?.environment, "an env value"),
        );
      }
      env = Object.fromEntries(resolved.entries);
      references = resolved.references;
    }
    const outcome = await run(command, context, env);
    const latencyMs = Math.round(performance.now() - started);
    if (outcome.kind === "exit" && outcome.code === 0) {
      return { ...base, ok: true, exitCode: 0, latencyMs };
    }
    return {
      ...base,
      ok: false,
      ...(outcome.kind === "exit" && outcome.code !== null ? { exitCode: outcome.code } : {}),
      latencyMs,
      ...failure(command, outcome, context.timeoutMs, references),
    };
  },
};
