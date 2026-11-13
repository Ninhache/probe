import { defineCommand } from "citty";
import { runChecks } from "../checkers/run";
import { DEFAULT_TIMEOUT_SECONDS, EXIT_DOWN } from "../constants";
import { formatCheckResults } from "../ui/report";
import { openProject, secondsToMs, stdoutColors } from "./shared";

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
    const timeoutMs = secondsToMs("--timeout", args.timeout);
    const { config } = await openProject();
    const results = await runChecks(config, args._, { timeoutMs });

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
