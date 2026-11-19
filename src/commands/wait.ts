import { defineCommand } from "citty";
import { pollUntilUp } from "../checkers/poll";
import { runChecks } from "../checkers/run";
import type { CheckResult } from "../checkers/types";
import { loadVariables, readSkippedServices } from "../config/local";
import {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_WAIT_INTERVAL_SECONDS,
  DEFAULT_WAIT_MAX_INTERVAL_SECONDS,
  DEFAULT_WAIT_TIMEOUT_SECONDS,
  EXIT_DOWN,
} from "../constants";
import { ProbeError } from "../errors";
import { formatCheckResults } from "../ui/report";
import {
  configFile,
  ENVIRONMENT_ARG,
  noServices,
  openProject,
  requireVariables,
  SET_ARG,
  secondsToMs,
  selectionFrom,
  stdoutGlyphs,
  stdoutTerminal,
  TAG_ARG,
  tagsFrom,
} from "./shared";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function progressReporter(): (results: CheckResult[], elapsedMs: number) => string[] {
  let previous: Map<string, boolean> | null = null;
  return (results, elapsedMs) => {
    const lines: string[] = [];
    if (previous === null) {
      const down = results.filter((result) => !result.ok).map((result) => result.name);
      if (down.length > 0) lines.push(`waiting for ${down.join(", ")}`);
    } else {
      for (const { name, ok } of results) {
        if (previous.get(name) === ok) continue;
        lines.push(ok ? `${name} up after ${seconds(elapsedMs)}` : `${name} down again`);
      }
    }
    previous = new Map(results.map((result) => [result.name, result.ok]));
    return lines;
  };
}

export default defineCommand({
  meta: {
    name: "wait",
    description: "Wait until services are up (all of them by default)",
  },
  args: {
    json: { type: "boolean", description: "Print the final results as JSON" },
    env: ENVIRONMENT_ARG,
    tag: TAG_ARG,
    set: SET_ARG,
    timeout: {
      type: "string",
      description: "Seconds to wait in total, all checks included, before giving up",
      default: String(DEFAULT_WAIT_TIMEOUT_SECONDS),
    },
    interval: {
      type: "string",
      description: "Seconds before the second check; the pause then doubles after each check",
      default: String(DEFAULT_WAIT_INTERVAL_SECONDS),
    },
    "max-interval": {
      type: "string",
      description: "Longest pause between two checks, in seconds",
      default: String(DEFAULT_WAIT_MAX_INTERVAL_SECONDS),
    },
  },
  async run({ args, rawArgs }) {
    const tags = tagsFrom(rawArgs);
    const deadlineMs = secondsToMs("--timeout", args.timeout);
    const intervalMs = secondsToMs("--interval", args.interval);
    const maxIntervalMs = secondsToMs("--max-interval", args["max-interval"]);
    if (intervalMs > maxIntervalMs) {
      throw new ProbeError(
        "USAGE",
        `--interval (${args.interval}s) cannot be longer than --max-interval (${args["max-interval"]}s).`,
      );
    }
    const { config, paths } = await openProject(args.env);
    const selection = selectionFrom(config, rawArgs);
    const skipped = await readSkippedServices(paths);
    const variables = await loadVariables(paths);
    requireVariables(config, args._, variables, skipped, tags);
    const report = progressReporter();

    const { results, timedOut } = await pollUntilUp(
      // A service with its own timeout keeps it here, within what is left of the total.
      (_passMs, remainingMs) =>
        runChecks(
          config,
          args._,
          {
            timeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
            maxTimeoutMs: remainingMs,
            variables,
            cwd: paths.root,
            configFile: configFile(paths),
            tags,
            selection,
          },
          skipped,
        ),
      {
        deadlineMs,
        attemptTimeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
        intervalMs,
        maxIntervalMs,
        onPass: (pass, elapsedMs) => {
          for (const line of report(pass, elapsedMs)) console.error(line);
        },
      },
    );

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      console.log(noServices(paths));
    } else {
      console.log(formatCheckResults(results, stdoutTerminal(), stdoutGlyphs()));
    }
    if (timedOut) {
      const down = results.filter((result) => !result.ok).map((result) => result.name);
      console.error(`probe: still down after ${deadlineMs / 1000}s: ${down.join(", ")}`);
      process.exitCode = EXIT_DOWN;
    }
  },
});
