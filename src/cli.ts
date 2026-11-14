#!/usr/bin/env node
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  renderUsage,
  runCommand,
  runMain,
} from "citty";
import add from "./commands/add";
import check from "./commands/check";
import init from "./commands/init";
import ls from "./commands/ls";
import migrate from "./commands/migrate";
import rm from "./commands/rm";
import { secondsToMs, stdoutTerminal } from "./commands/shared";
import status from "./commands/status";
import sync from "./commands/sync";
import wait from "./commands/wait";
import { findProbeDir, requireProbeDir } from "./config/discovery";
import { loadConfig, writeServiceTimeout } from "./config/loader";
import {
  changedPreferences,
  initialDashboardSettings,
  readDashboardPreferences,
  readSkippedServices,
  writeDashboardPreferences,
  writeServiceSkip,
} from "./config/local";
import {
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
import { detectTerminal, isInteractive, stripStyles } from "./ui/terminal";
import {
  cacheDir,
  refreshCache,
  scheduleRefresh,
  updateCheckDisabled,
  updateNotice,
} from "./update/notifier";
import { CLI_VERSION } from "./version";

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
  subCommands: { init, add, rm, ls, check, wait, status, sync, migrate },
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
  if (updateCheckDisabled() || !cliPath) return;
  scheduleRefresh(cacheDir(), cliPath);
  // `status` prints the update line itself.
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

/**
 * Reads the arguments the dashboard accepts: none, or `--interval` alone.
 * Returns the interval in seconds as typed, `undefined` when not given, `null` for any other arguments.
 */
function dashboardInterval(rawArgs: string[]): string | undefined | null {
  const [first, second, ...rest] = rawArgs;
  if (first === undefined) return undefined;
  if (first.startsWith(`${INTERVAL_OPTION}=`) && second === undefined)
    return first.slice(INTERVAL_OPTION.length + 1);
  if (first === INTERVAL_OPTION && rest.length === 0) return second ?? "";
  return null;
}

/**
 * `probe` alone on a terminal, inside a project with services, opens the dashboard.
 * The interactive libraries are imported here only, so every other path starts without them.
 * With `--interval` there is nothing to fall back to: what prevents the dashboard is an error.
 * Settings come from `--interval`, then `local.yml`, then the defaults; what the panels change
 * is saved to `local.yml`, except the timeout of a service: it is shared, so it goes to `config.yml`.
 */
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
  await openDashboard(config, stdoutTerminal(), {
    settings,
    skipped: await readSkippedServices(paths),
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
  });
  await saves.idle();
  // The dashboard said so too, but its screen is gone once it closes.
  for (const failure of saves.failures()) console.error(`probe: not saved: ${failure}`);
  return true;
}

const UNKNOWN_COMMAND = "E_UNKNOWN_COMMAND";

/** The command a mistyped one was probably meant to be, as a sentence to add to citty's error. */
function didYouMean(error: Error, rawArgs: string[]): string {
  if ((error as { code?: string }).code !== UNKNOWN_COMMAND) return "";
  const typed = rawArgs.find((arg) => !arg.startsWith("-"));
  const command = typed && closest(typed, Object.keys(main.subCommands ?? {}));
  return command ? ` Did you mean: probe ${command}?` : "";
}

/** Resolves once everything written to the stream so far has left the process. */
function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((done) => {
    stream.write("", () => done());
  });
}

async function run(rawArgs: string[]): Promise<void> {
  if (rawArgs[0] === REFRESH_COMMAND) return refreshCache(cacheDir());

  const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
  const wantsVersion = rawArgs.length === 1 && ["--version", "-v"].includes(rawArgs[0] as string);
  if (wantsHelp || wantsVersion) return runMain(main, { rawArgs, showUsage: printUsage });

  try {
    if (!(await openedDashboard(rawArgs))) await runCommand(main, { rawArgs });
  } catch (error) {
    process.exitCode = EXIT_ERROR;
    if (error instanceof ProbeError) {
      console.error(`probe: ${error.message}`);
    } else if (error instanceof Error && error.name === "CLIError") {
      // citty's own usage errors (unknown command, missing argument)
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
