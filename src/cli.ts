#!/usr/bin/env node
import { defineCommand, runCommand, runMain, showUsage } from "citty";
import add from "./commands/add";
import check from "./commands/check";
import init from "./commands/init";
import ls from "./commands/ls";
import migrate from "./commands/migrate";
import rm from "./commands/rm";
import status from "./commands/status";
import sync from "./commands/sync";
import { EXIT_ERROR, REFRESH_COMMAND } from "./constants";
import { ProbeError } from "./errors";
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
  subCommands: { init, add, rm, ls, check, status, sync, migrate },
});

function notifyUpdate(rawArgs: string[]): void {
  const cliPath = process.argv[1];
  if (updateCheckDisabled() || !cliPath) return;
  scheduleRefresh(cacheDir(), cliPath);
  // `status` prints the update line itself.
  if (!process.stderr.isTTY || rawArgs.includes("--json") || rawArgs[0] === "status") return;
  const notice = updateNotice(CLI_VERSION, cacheDir());
  if (notice) console.error(`\n${notice}`);
}

async function run(rawArgs: string[]): Promise<void> {
  if (rawArgs[0] === REFRESH_COMMAND) return refreshCache(cacheDir());

  const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
  const wantsVersion = rawArgs.length === 1 && ["--version", "-v"].includes(rawArgs[0] as string);
  if (wantsHelp || wantsVersion) return runMain(main, { rawArgs });

  try {
    await runCommand(main, { rawArgs });
  } catch (error) {
    process.exitCode = EXIT_ERROR;
    if (error instanceof ProbeError) {
      console.error(`probe: ${error.message}`);
    } else if (error instanceof Error && error.name === "CLIError") {
      // citty's own usage errors (unknown command, missing argument)
      if (rawArgs.length === 0) await showUsage(main);
      console.error(`probe: ${error.message.replace(/\.$/, "")}. See: probe --help`);
    } else {
      throw error;
    }
  }
  notifyUpdate(rawArgs);
}

await run(process.argv.slice(2));
