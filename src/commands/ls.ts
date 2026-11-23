import { defineCommand } from "citty";
import { readServiceOverrides, readSkippedServices } from "../config/local";
import { overriddenKeys, withOverrides } from "../config/overrides";
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
    const overrides = await readServiceOverrides(paths);
    const reached = withOverrides(declared, overrides);
    const config = applySelection(reached, selectionFrom(reached, rawArgs));
    if (Object.keys(config.services).length === 0) {
      console.log(noServices(paths));
      return;
    }
    const local = Object.fromEntries(
      Object.keys(config.services).map((name) => [name, overriddenKeys(overrides, name)]),
    );
    console.log(formatServices(config, stdoutTerminal(), await readSkippedServices(paths), local));
  },
});
