#!/usr/bin/env node
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  renderUsage,
  runCommand,
  runMain,
} from "citty";
import add, { guidedAdd } from "./commands/add";
import check from "./commands/check";
import completionCommand from "./commands/completion";
import curl from "./commands/curl";
import init, { ignoreLocalFiles, initProject } from "./commands/init";
import ls from "./commands/ls";
import migrate from "./commands/migrate";
import open from "./commands/open";
import rm from "./commands/rm";
import { type ServiceWritten, writeService } from "./commands/service-writes";
import { secondsToMs, stdoutTerminal } from "./commands/shared";
import status from "./commands/status";
import sync from "./commands/sync";
import variable from "./commands/var";
import wait from "./commands/wait";
import { completableEnvironments, completableServices } from "./completion/services";
import { COMPLETION_COMMAND } from "./completion/spec";
import { findProbeDir, requireProbeDir } from "./config/discovery";
import { loadConfig, writeServiceTimeout } from "./config/loader";
import {
  changedPreferences,
  initialDashboardSettings,
  loadVariables,
  readDashboardPreferences,
  readLocalVariables,
  readSkippedServices,
  variableSource,
  writeDashboardPreferences,
  writeServiceSkip,
  writeVariable,
} from "./config/local";
import {
  COMPLETE_COMMAND,
  CONFIG_FILE,
  DASHBOARD_INTERVAL_SECONDS,
  EXIT_ERROR,
  LOCAL_FILE,
  PROBE_DIR,
  REFRESH_COMMAND,
} from "./constants";
import { createSaveQueue } from "./dashboard/saves";
import { ProbeError } from "./errors";
import { closest } from "./suggest";
import { formatExamples } from "./ui/examples";
import { confirm } from "./ui/prompt";
import { detectTerminal, isInteractive, stripStyles } from "./ui/terminal";
import {
  cacheDir,
  refreshCache,
  scheduleRefresh,
  updateCheckDisabled,
  updateNotice,
} from "./update/notifier";
import { CLI_VERSION } from "./version";

const commands = {
  init,
  add,
  rm,
  ls,
  check,
  wait,
  open,
  curl,
  var: variable,
  status,
  sync,
  migrate,
};

const main = defineCommand({
  meta: {
    name: "probe",
    version: CLI_VERSION,
    description: "Health checks for your local dev services",
  },
  args: {
    interval: {
      type: "string",
      valueHint: "seconds",
      description: "Seconds between two refreshes of the dashboard (probe alone, on a terminal)",
      default: String(DASHBOARD_INTERVAL_SECONDS),
    },
  },
  subCommands: { ...commands, completion: completionCommand(commands) },
});

// citty styles its usage text whatever the stream is: strip it when stdout shows no colour.
// Its usage has no room for examples: they are added after it.
async function printUsage<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const usage = await renderUsage(command, parent);
  const { color } = stdoutTerminal();
  const meta = await (typeof command.meta === "function" ? command.meta() : command.meta);
  const examples = formatExamples(command === main ? undefined : meta?.name, color);
  console.log(`${color ? usage : stripStyles(usage)}\n${examples ? `\n${examples}\n` : ""}`);
}

function notifyUpdate(rawArgs: string[]): void {
  const cliPath = process.argv[1];
  // The completion script is printed at every shell start: no registry lookup, no notice there.
  if (updateCheckDisabled() || !cliPath || rawArgs[0] === COMPLETION_COMMAND) return;
  scheduleRefresh(cacheDir(), cliPath);
  if (
    !detectTerminal(process.stderr, process.env).isTTY ||
    rawArgs.includes("--json") ||
    rawArgs[0] === "status"
  )
    return;
  const notice = updateNotice(CLI_VERSION, cacheDir());
  if (notice) console.error(`\n${notice}`);
}

const INTERVAL_OPTION = "--interval";

function dashboardInterval(rawArgs: string[]): string | undefined | null {
  const [first, second, ...rest] = rawArgs;
  if (first === undefined) return undefined;
  if (first.startsWith(`${INTERVAL_OPTION}=`) && second === undefined)
    return first.slice(INTERVAL_OPTION.length + 1);
  if (first === INTERVAL_OPTION && rest.length === 0) return second ?? "";
  return null;
}

// The interactive libraries are imported here only: every other path starts without them.
async function openedDashboard(rawArgs: string[]): Promise<boolean> {
  const interval = dashboardInterval(rawArgs);
  if (interval === null) return false;
  const asked = interval !== undefined;
  const askedMs = asked ? secondsToMs(INTERVAL_OPTION, interval) : undefined;
  if (!isInteractive(process.stdin, process.stdout, process.env)) {
    if (!asked) return false;
    throw new ProbeError(
      "USAGE",
      `${INTERVAL_OPTION} sets the refresh of the dashboard, which needs an interactive terminal.`,
    );
  }
  const paths = asked ? requireProbeDir(process.cwd()) : findProbeDir(process.cwd());
  if (!paths) return false;
  const { config } = await loadConfig(paths);
  if (Object.keys(config.services).length === 0) {
    if (!asked) return false;
    throw new ProbeError("USAGE", "No services yet. Add one: probe add api -p 3000");
  }
  const { openDashboard } = await import("./dashboard/open");
  let settings = initialDashboardSettings(askedMs, await readDashboardPreferences(paths));
  const saves = createSaveQueue();
  const local = `${PROBE_DIR}/${LOCAL_FILE}`;
  const saveLocal = (write: () => Promise<boolean>) =>
    saves.save(local, write, `${local} cannot be edited safely: fix or delete it`);
  const keepVariable = async (name: string, value: string) => {
    // Before the value is written: the file that holds it must never be committed.
    await ignoreLocalFiles(paths.root);
    return writeVariable(paths, name, value);
  };
  await openDashboard(config, stdoutTerminal(), {
    settings,
    skipped: await readSkippedServices(paths),
    variables: () => loadVariables(paths),
    variableSources: async (names) => {
      const { values } = await readLocalVariables(paths);
      return Object.fromEntries(
        names.map((name) => [name, variableSource(name, values, process.env)]),
      );
    },
    onVariableWrite: (name, value) => saveLocal(() => keepVariable(name, value)),
    onSettingsChange: (next) => {
      const changed = changedPreferences(settings, next);
      settings = next;
      return saveLocal(() => writeDashboardPreferences(paths, changed));
    },
    onSkipChange: (name, skip) => saveLocal(() => writeServiceSkip(paths, name, skip)),
    onTimeoutChange: (name, seconds) =>
      saves.save(
        `${PROBE_DIR}/${CONFIG_FILE}`,
        () => writeServiceTimeout(paths, name, seconds),
        `${name} is no longer in ${PROBE_DIR}/${CONFIG_FILE}`,
      ),
    onServiceWrite: async (write, secrets = {}) => {
      let written: ServiceWritten | null = null;
      let failure = await saves.save(
        `${PROBE_DIR}/${CONFIG_FILE}`,
        async () => {
          written = await writeService(paths, write);
          return written !== null;
        },
        write.kind === "add"
          ? `${write.name} is already in ${PROBE_DIR}/${CONFIG_FILE}`
          : `${write.name} is no longer in ${PROBE_DIR}/${CONFIG_FILE}`,
      );
      // After the config: a service that was not written leaves no secret behind.
      for (const [name, value] of written ? Object.entries(secrets) : [])
        failure = (await saveLocal(() => keepVariable(name, value))) ?? failure;
      return { failure, ...(written as ServiceWritten | null) };
    },
  });
  await saves.idle();
  // The dashboard said so too, but its screen is gone once it closes.
  for (const failure of saves.failures()) console.error(`probe: not saved: ${failure}`);
  return true;
}

async function offeredInit(error: unknown, rawArgs: string[]): Promise<boolean> {
  if (!(error instanceof ProbeError) || error.code !== "NO_PROBE_DIR") return false;
  if (rawArgs.includes("--json")) return false;
  if (!isInteractive(process.stdin, process.stdout, process.env)) return false;
  const root = process.cwd();
  if (!(await confirm(`No ${PROBE_DIR}/ here. Create it in ${root}?`))) return false;
  await initProject(root);
  console.log(`Created ${PROBE_DIR}/.`);
  return true;
}

function wantsGuidedAdd(rawArgs: string[]): boolean {
  return (
    rawArgs.length === 1 &&
    rawArgs[0] === "add" &&
    isInteractive(process.stdin, process.stdout, process.env)
  );
}

async function dispatch(rawArgs: string[]): Promise<void> {
  if (wantsGuidedAdd(rawArgs)) return guidedAdd();
  if (!(await openedDashboard(rawArgs))) await runCommand(main, { rawArgs });
}

const UNKNOWN_COMMAND = "E_UNKNOWN_COMMAND";

function didYouMean(error: Error, rawArgs: string[]): string {
  if ((error as { code?: string }).code !== UNKNOWN_COMMAND) return "";
  const typed = rawArgs.find((arg) => !arg.startsWith("-"));
  const command = typed && closest(typed, Object.keys(main.subCommands ?? {}));
  return command ? ` Did you mean: probe ${command}?` : "";
}

function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((done) => {
    stream.write("", () => done());
  });
}

/** Answers the completion scripts: one word per line, and never an error, a Tab must stay silent. */
async function printCompletions(kind: string | undefined): Promise<void> {
  const lists: Record<string, (cwd: string) => Promise<string[]>> = {
    services: completableServices,
    environments: completableEnvironments,
  };
  const names = kind !== undefined && Object.hasOwn(lists, kind) ? lists[kind] : undefined;
  for (const name of (await names?.(process.cwd()).catch(() => [])) ?? []) console.log(name);
}

async function run(rawArgs: string[]): Promise<void> {
  if (rawArgs[0] === REFRESH_COMMAND) return refreshCache(cacheDir());
  if (rawArgs[0] === COMPLETE_COMMAND) return printCompletions(rawArgs[1]);

  const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
  const wantsVersion = rawArgs.length === 1 && ["--version", "-v"].includes(rawArgs[0] as string);
  if (wantsHelp || wantsVersion) return runMain(main, { rawArgs, showUsage: printUsage });

  try {
    try {
      await dispatch(rawArgs);
    } catch (error) {
      if (!(await offeredInit(error, rawArgs))) throw error;
      await dispatch(rawArgs);
    }
  } catch (error) {
    process.exitCode = EXIT_ERROR;
    if (error instanceof ProbeError) {
      console.error(`probe: ${error.message}`);
    } else if (error instanceof Error && error.name === "CLIError") {
      if (rawArgs.length === 0) await printUsage(main);
      const message = stripStyles(error.message).replace(/\.$/, "");
      console.error(`probe: ${message}.${didYouMean(error, rawArgs)} See: probe --help`);
    } else {
      // No rethrow: an uncaught error exits 1, which callers read as "a service is down".
      console.error(`probe: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  notifyUpdate(rawArgs);
  // A check cut short can leave a socket connecting for seconds: do not wait for it.
  await flushed(process.stdout);
  await flushed(process.stderr);
  process.exit();
}

await run(process.argv.slice(2));
