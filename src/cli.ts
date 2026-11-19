#!/usr/bin/env node
import { type ArgsDef, type CommandDef, defineCommand, runCommand, runMain } from "citty";
import { guidedAdd } from "./commands/add";
import completionCommand from "./commands/completion";
import { createEnvironment, EMPTY_ENVIRONMENT, environmentFile } from "./commands/env-create";
import { initProject } from "./commands/init";
import { commands } from "./commands/registry";
import { noServices, secondsToMs, stdoutTerminal } from "./commands/shared";
import {
  completableEnvironments,
  completableServices,
  completableTags,
} from "./completion/services";
import { COMPLETION_COMMAND } from "./completion/spec";
import { findProbeDir, requireProbeDir } from "./config/discovery";
import { listEnvironments } from "./config/environments";
import { loadConfig } from "./config/loader";
import {
  initialDashboardSettings,
  loadVariables,
  readDashboardPreferences,
  readDashboardSelection,
  readSkippedServices,
} from "./config/local";
import {
  COMPLETE_COMMAND,
  DASHBOARD_INTERVAL_SECONDS,
  EXIT_DOWN,
  EXIT_ERROR,
  PROBE_DIR,
  REFRESH_COMMAND,
} from "./constants";
import { dashboardWrites } from "./dashboard/writes";
import { ProbeError } from "./errors";
import { closest } from "./suggest";
import { type HelpCommand, renderCommandHelp, renderRootHelp } from "./ui/help";
import { linkFileIn } from "./ui/links";
import { confirm } from "./ui/prompt";
import { detectTerminal, isInteractive, stripStyles } from "./ui/terminal";
import {
  cacheDir,
  refreshCache,
  scheduleRefresh,
  updateCheckDisabled,
  updateNotice,
} from "./update/notifier";
import { staleCompletions } from "./update/stale-completion";
import {
  currentNotes,
  markFirstRun,
  newsOf,
  takeWhatsNew,
  whatsNewNotice,
} from "./update/whats-new";
import { CLI_VERSION } from "./version";

const subCommands = { ...commands, completion: completionCommand(commands) };

const main = defineCommand({
  meta: {
    name: "probe",
    version: CLI_VERSION,
    description: "Health checks for your local dev services",
  },
  args: {
    interval: {
      type: "string",
      valueHint: "s",
      description: "Dashboard refresh",
      default: String(DASHBOARD_INTERVAL_SECONDS),
    },
    once: {
      type: "boolean",
      description: "Check once and exit",
    },
  },
  subCommands,
});

// citty's own renderer lists every command on one line and cannot group or colour: ours is used.
async function printUsage<T extends ArgsDef = ArgsDef>(command: CommandDef<T>): Promise<void> {
  const { color } = stdoutTerminal();
  if (command === (main as unknown)) {
    const meta = await (typeof main.meta === "function" ? main.meta() : main.meta);
    console.log(
      await renderRootHelp({
        version: CLI_VERSION,
        description: meta?.description ?? "",
        commands: subCommands as Record<string, HelpCommand>,
        args: (main.args ?? {}) as never,
        color,
        firstRun: findProbeDir(process.cwd()) === null,
      }),
    );
    return;
  }
  const meta = await (typeof command.meta === "function" ? command.meta() : command.meta);
  console.log(
    await renderCommandHelp({ name: meta?.name ?? "", command: command as HelpCommand, color }),
  );
}

function notifyUpdate(rawArgs: string[]): void {
  const cliPath = process.argv[1];
  if (updateCheckDisabled() || !cliPath || rawArgs[0] === COMPLETION_COMMAND) return;
  const stderr = detectTerminal(process.stderr, process.env);
  const quiet = !stderr.isTTY || rawArgs.includes("--json");
  // Before the refresh: that writes the cache file, which tells an upgrade from a first install.
  if (quiet) markFirstRun(CLI_VERSION, cacheDir());
  const news = quiet ? null : whatsNewNotice(CLI_VERSION, cacheDir(), stderr.color);
  scheduleRefresh(cacheDir(), cliPath);
  if (quiet) return;
  if (news) console.error(`\n${news}`);
  if (rawArgs[0] === "status" || rawArgs[0] === "doctor") return;
  const notice = updateNotice(CLI_VERSION, cacheDir());
  if (notice) console.error(`\n${notice}`);
}

/** The notes for the dashboard: shown when it opens after an update, and again on demand. */
function dashboardNews() {
  const opening = updateCheckDisabled() ? null : takeWhatsNew(CLI_VERSION, cacheDir());
  const news = (upgrade: Parameters<typeof newsOf>[0]) =>
    newsOf(upgrade, staleCompletions(CLI_VERSION));
  return {
    show: opening ? news(opening) : undefined,
    again: () => {
      const upgrade = currentNotes(CLI_VERSION);
      return upgrade ? news(upgrade) : undefined;
    },
  };
}

const INTERVAL_OPTION = "--interval";
const ONCE_OPTION = "--once";

function dashboardInterval(rawArgs: string[]): string | undefined | null {
  const [first, second, ...rest] = rawArgs;
  if (first === undefined) return undefined;
  if (first.startsWith(`${INTERVAL_OPTION}=`) && second === undefined)
    return first.slice(INTERVAL_OPTION.length + 1);
  if (first === INTERVAL_OPTION && rest.length === 0) return second ?? "";
  return null;
}

// The interactive libraries are imported here only: every other path starts without them.
async function openedDashboard(allArgs: string[]): Promise<boolean> {
  const once = allArgs.includes(ONCE_OPTION);
  const rawArgs = once ? allArgs.filter((arg) => arg !== ONCE_OPTION) : allArgs;
  const interval = dashboardInterval(rawArgs);
  if (interval === null) return false;
  const asked = interval !== undefined;
  const askedMs = asked ? secondsToMs(INTERVAL_OPTION, interval) : undefined;
  const interactive = isInteractive(process.stdin, process.stdout, process.env);
  // Nobody to draw for, or one pass asked for: a table, then the exit code.
  if (!interactive && asked)
    throw new ProbeError(
      "USAGE",
      `${INTERVAL_OPTION} sets the refresh of the dashboard, which needs an interactive terminal.`,
    );
  const plain = once || !interactive;
  const paths = asked || once ? requireProbeDir(process.cwd()) : findProbeDir(process.cwd());
  if (!paths) return false;
  const { config } = await loadConfig(paths);
  const environments = await listEnvironments(paths);
  if (plain) {
    const { oncePass } = await import("./dashboard/native/once");
    const { environmentSource: source } = await import("./dashboard/sources");
    const settings = initialDashboardSettings(askedMs, await readDashboardPreferences(paths));
    const { text, down } = await oncePass({
      config,
      variables: await loadVariables(paths),
      skipped: await readSkippedServices(paths),
      selection: await readDashboardSelection(paths),
      timeoutMs: settings.timeoutMs,
      environments: environments.map((name) => source(paths, name)),
      terminal: stdoutTerminal(),
      empty: noServices(paths),
    });
    console.log(text);
    if (down) process.exitCode = EXIT_DOWN;
    return true;
  }
  if (Object.keys(config.services).length === 0 && environments.length === 0) {
    if (!asked) return false;
    throw new ProbeError("USAGE", "No services yet. Add one: probe add api -p 3000");
  }
  const settings = initialDashboardSettings(askedMs, await readDashboardPreferences(paths));
  const { saves, writes } = dashboardWrites(paths, settings);
  const { environmentSource: source } = await import("./dashboard/sources");
  const { openNativeDashboard } = await import("./dashboard/native/open");
  await openNativeDashboard({
    config,
    environments: environments.map((name) => source(paths, name)),
    settings,
    selection: await readDashboardSelection(paths),
    skipped: await readSkippedServices(paths),
    whatsNew: dashboardNews(),
    onEnvironmentCreate: async (name, from) => {
      const { variables } = await createEnvironment(paths, name, from);
      const sends = variables.map(
        (variable) => `It sends ${variable}: probe var ${variable} --env ${name} (or export it).`,
      );
      const told =
        from === EMPTY_ENVIRONMENT
          ? `Created ${environmentFile(name)}, with no service.`
          : `Created ${environmentFile(name)} from ${environmentFile(from)}.`;
      return { source: source(paths, name), message: [told, ...sends].join("\n") };
    },
    onEnvironmentsList: async () =>
      (await listEnvironments(paths)).map((name) => source(paths, name)),
    ...writes,
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

// Ignored, `--env` would let `probe rm api --env prod` remove the local service.
const SCOPED_OPTIONS = [
  { arg: "env", elsewhere: "the other commands work on the local services" },
  { arg: "set", elsewhere: "elsewhere a parameter takes its first value" },
];

function refuseStrayOptions(rawArgs: string[]): void {
  for (const { arg, elsewhere } of SCOPED_OPTIONS) {
    const flag = `--${arg}`;
    if (!rawArgs.some((given) => given === flag || given.startsWith(`${flag}=`))) continue;
    const reading = Object.entries(commands)
      .filter(([, command]) => arg in (command.args ?? {}))
      .map(([name]) => name);
    const typed = rawArgs.find((given) => !given.startsWith("-"));
    if (typed !== undefined && reading.includes(typed)) continue;
    throw new ProbeError("USAGE", `${flag} is read by ${reading.join(", ")} only: ${elsewhere}.`);
  }
}

async function dispatch(rawArgs: string[]): Promise<void> {
  refuseStrayOptions(rawArgs);
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
    tags: completableTags,
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
      const { file, message } = error;
      const { hyperlinks } = detectTerminal(process.stderr, process.env);
      const shown = file === undefined ? message : linkFileIn(message, file, hyperlinks);
      console.error(`probe: ${shown}`);
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
