import { defineCommand } from "citty";
import { runChecks } from "../checkers/run";
import { loadVariables, readSkippedServices } from "../config/local";
import { DEFAULT_TIMEOUT_SECONDS, EXIT_DOWN } from "../constants";
import { formatCheckResults } from "../ui/report";
import {
  configFile,
  ENVIRONMENT_ARG,
  noServices,
  openProject,
  secondsToMs,
  stdoutTerminal,
} from "./shared";

export default defineCommand({
  meta: { name: "check", description: "Check that services respond (all of them by default)" },
  args: {
    json: { type: "boolean", description: "Print results as JSON" },
    env: ENVIRONMENT_ARG,
    timeout: {
      type: "string",
      // No citty default: a value given here must be told apart from none, it beats the services' own.
      description: `Seconds to wait for each service (default: its own timeout, else ${DEFAULT_TIMEOUT_SECONDS})`,
    },
  },
  async run({ args }) {
    const forceTimeout = args.timeout !== undefined;
    const timeoutMs = secondsToMs("--timeout", args.timeout ?? String(DEFAULT_TIMEOUT_SECONDS));
    const { config, paths } = await openProject(args.env);
    const skipped = await readSkippedServices(paths);
    const variables = await loadVariables(paths);
    const results = await runChecks(
      config,
      args._,
      { timeoutMs, forceTimeout, variables, configFile: configFile(paths) },
      skipped,
    );

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      console.log(noServices(paths));
    } else {
      console.log(formatCheckResults(results, stdoutTerminal()));
    }
    if (results.some((result) => !result.ok)) process.exitCode = EXIT_DOWN;
  },
});
