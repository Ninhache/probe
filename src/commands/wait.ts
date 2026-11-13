import { defineCommand } from "citty";
import { pollUntilUp } from "../checkers/poll";
import { runChecks } from "../checkers/run";
import type { CheckResult } from "../checkers/types";
import {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_WAIT_INTERVAL_SECONDS,
  DEFAULT_WAIT_MAX_INTERVAL_SECONDS,
  DEFAULT_WAIT_TIMEOUT_SECONDS,
  EXIT_DOWN,
} from "../constants";
import { formatCheckResults } from "../ui/report";
import { openProject, secondsToMs, stdoutColors } from "./shared";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Returns a reporter that turns each pass into the lines worth printing: only what changed. */
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
    description: "Check again and again until services are up (all of them by default)",
  },
  args: {
    json: { type: "boolean", description: "Print the final results as JSON" },
    timeout: {
      type: "string",
      description: "Seconds to wait in total before giving up",
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
  async run({ args }) {
    const deadlineMs = secondsToMs("--timeout", args.timeout);
    const intervalMs = secondsToMs("--interval", args.interval);
    const maxIntervalMs = secondsToMs("--max-interval", args["max-interval"]);
    const { config } = await openProject();
    const report = progressReporter();

    const { results, timedOut } = await pollUntilUp(
      (timeoutMs) => runChecks(config, args._, { timeoutMs }),
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
      console.log("No services yet. Add one: probe add api -p 3000");
    } else {
      console.log(formatCheckResults(results, stdoutColors()));
    }
    if (timedOut) {
      const down = results.filter((result) => !result.ok).map((result) => result.name);
      console.error(`probe: still down after ${Number(args.timeout)}s: ${down.join(", ")}`);
      process.exitCode = EXIT_DOWN;
    }
  },
});
