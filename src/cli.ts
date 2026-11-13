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
import { stdoutTerminal } from "./commands/shared";
import status from "./commands/status";
import sync from "./commands/sync";
import wait from "./commands/wait";
import { findProbeDir } from "./config/discovery";
import { loadConfig } from "./config/loader";
import { EXIT_ERROR, REFRESH_COMMAND } from "./constants";
import { ProbeError } from "./errors";
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
  subCommands: { init, add, rm, ls, check, wait, status, sync, migrate },
});

// citty styles its usage text whatever the stream is: strip it when stdout shows no colour.
async function printUsage<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const usage = await renderUsage(command, parent);
  console.log(`${stdoutTerminal().color ? usage : stripStyles(usage)}\n`);
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

/**
 * Bare `probe` on a terminal, inside a project with services, opens the dashboard.
 * The interactive libraries are imported here only, so every other path starts without them.
 */
async function openedDashboard(rawArgs: string[]): Promise<boolean> {
  if (rawArgs.length > 0 || !isInteractive(process.stdin, process.stdout, process.env))
    return false;
  const paths = findProbeDir(process.cwd());
  if (!paths) return false;
  const { config } = await loadConfig(paths);
  if (Object.keys(config.services).length === 0) return false;
  const { openDashboard } = await import("./dashboard/open");
  await openDashboard(config, stdoutTerminal());
  return true;
}

async function run(rawArgs: string[]): Promise<void> {
  if (rawArgs[0] === REFRESH_COMMAND) return refreshCache(cacheDir());

  const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
  const wantsVersion = rawArgs.length === 1 && ["--version", "-v"].includes(rawArgs[0] as string);
  if (wantsHelp || wantsVersion) return runMain(main, { rawArgs, showUsage: printUsage });

  let dashboard = false;
  try {
    dashboard = await openedDashboard(rawArgs);
    if (!dashboard) await runCommand(main, { rawArgs });
  } catch (error) {
    process.exitCode = EXIT_ERROR;
    if (error instanceof ProbeError) {
      console.error(`probe: ${error.message}`);
    } else if (error instanceof Error && error.name === "CLIError") {
      // citty's own usage errors (unknown command, missing argument)
      if (rawArgs.length === 0) await printUsage(main);
      console.error(`probe: ${error.message.replace(/\.$/, "")}. See: probe --help`);
    } else {
      // No rethrow: an uncaught error exits 1, which callers read as "a service is down".
      console.error(`probe: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  notifyUpdate(rawArgs);
  // A check cut short can leave a socket connecting for seconds: do not wait for it.
  if (dashboard) process.exit();
}

await run(process.argv.slice(2));
