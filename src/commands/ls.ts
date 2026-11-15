import { defineCommand } from "citty";
import { readSkippedServices } from "../config/local";
import { formatServices } from "../ui/report";
import { ENVIRONMENT_ARG, noServices, openProject, stdoutTerminal } from "./shared";

export default defineCommand({
  meta: { name: "ls", description: "List services" },
  args: { env: ENVIRONMENT_ARG },
  async run({ args }) {
    const { config, paths } = await openProject(args.env);
    if (Object.keys(config.services).length === 0) {
      console.log(noServices(paths));
      return;
    }
    console.log(formatServices(config, stdoutTerminal(), await readSkippedServices(paths)));
  },
});
