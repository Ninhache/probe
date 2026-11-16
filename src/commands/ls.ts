import { defineCommand } from "citty";
import { readSkippedServices } from "../config/local";
import { applySelection } from "../config/parameters";
import { formatServices } from "../ui/report";
import {
  ENVIRONMENT_ARG,
  noServices,
  openProject,
  SET_ARG,
  selectionFrom,
  stdoutTerminal,
} from "./shared";

export default defineCommand({
  meta: { name: "ls", description: "List services" },
  args: { env: ENVIRONMENT_ARG, set: SET_ARG },
  async run({ args, rawArgs }) {
    const { config: declared, paths } = await openProject(args.env);
    const config = applySelection(declared, selectionFrom(declared, rawArgs));
    if (Object.keys(config.services).length === 0) {
      console.log(noServices(paths));
      return;
    }
    console.log(formatServices(config, stdoutTerminal(), await readSkippedServices(paths)));
  },
});
