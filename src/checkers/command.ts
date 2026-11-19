import { type ChildProcess, spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { Service } from "../config/schema";
import { COMMAND_STDERR_BYTES, COMMAND_STDERR_CHARACTERS, EXIT_DRAIN_MS } from "../constants";
import { truncate } from "../ui/terminal";
import { commandForm } from "./command-form";
import { CONFIG } from "./diagnosis";
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

const programOf = (command: Command): string =>
  typeof command === "string" ? command : (command[0] as string);

/** Kills the command and everything it started: a timeout must not leave a server running. */
function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const { pid } = child;
  if (pid === undefined) return;
  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is gone already, or never was one: the child itself is all that is left.
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

function lastLine(stderr: string): string | undefined {
  const lines = stripVTControlCharacters(stderr)
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines.at(-1);
  return last === undefined ? undefined : truncate(last, COMMAND_STDERR_CHARACTERS);
}

function run(
  command: Command,
  { timeoutMs, signal, cwd }: Pick<CheckContext, "timeoutMs" | "signal" | "cwd">,
): Promise<Outcome> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ kind: "aborted" });
    const options = {
      cwd,
      stdio: ["ignore", "ignore", "pipe"] as ["ignore", "ignore", "pipe"],
      windowsHide: true,
      // Its own process group on POSIX, so the whole tree can be killed at once.
      detached: process.platform !== "win32",
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
      killTree(child);
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

function failure(command: Command, outcome: Outcome, timeoutMs: number) {
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
    const windows = process.platform === "win32" && typeof command !== "string";
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
  return { error: lastLine(outcome.stderr) ?? `exit ${outcome.code}` };
}

export const commandChecker: ServiceType = {
  type: "command",
  target: (service) => commandTarget(service.command as Command),
  copy: (service) => ({
    command: shellCommand(service.command as Command),
    note: "it runs from the project root",
  }),
  form: commandForm,
  async check(name, service, context): Promise<CheckResult> {
    const command = service.command as Command;
    const base = { name, type: "command", target: commandTarget(command) };
    const started = performance.now();
    const outcome = await run(command, context);
    const latencyMs = Math.round(performance.now() - started);
    if (outcome.kind === "exit" && outcome.code === 0) {
      return { ...base, ok: true, exitCode: 0, latencyMs };
    }
    return {
      ...base,
      ok: false,
      ...(outcome.kind === "exit" && outcome.code !== null ? { exitCode: outcome.code } : {}),
      latencyMs,
      ...failure(command, outcome, context.timeoutMs),
    };
  },
};
