import { defineCommand } from "citty";
import { runChecks } from "../checkers/run";
import { DEFAULT_TIMEOUT_SECONDS, EXIT_DOWN } from "../constants";
import { ProbeError } from "../errors";
import { formatCheckResults } from "../ui/report";
import { openProject, stdoutColors } from "./shared";

// setTimeout overflows above 2^31 ms and then fires at once.
const MAX_TIMEOUT_SECONDS = 2_147_483;

export default defineCommand({
  meta: { name: "check", description: "Check that services respond (all of them by default)" },
  args: {
    json: { type: "boolean", description: "Print results as JSON" },
    timeout: {
      type: "string",
      description: "Seconds to wait for each service",
      default: String(DEFAULT_TIMEOUT_SECONDS),
    },
  },
  async run({ args }) {
    const seconds = Number(args.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMEOUT_SECONDS) {
      throw new ProbeError(
        "USAGE",
        `--timeout expects seconds between 0 and ${MAX_TIMEOUT_SECONDS}, got "${args.timeout}".`,
      );
    }
    const { config } = await openProject();
    const results = await runChecks(config, args._, { timeoutMs: Math.ceil(seconds * 1000) });

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      console.log("No services yet. Add one: probe add api -p 3000");
    } else {
      console.log(formatCheckResults(results, stdoutColors()));
    }
    if (results.some((result) => !result.ok)) process.exitCode = EXIT_DOWN;
  },
});
