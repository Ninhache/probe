import { defineCommand } from "citty";
import { readSkippedServices } from "../config/local";
import { overriddenKeys } from "../config/overrides";
import { applySelection } from "../config/parameters";
import { formatServices } from "../ui/report";
import {
  ENVIRONMENT_ARG,
  noServices,
  openProject,
  reachedServices,
  SET_ARG,
  selectionFrom,
  stdoutTerminal,
} from "./shared";

export default defineCommand({
  meta: { name: "ls", description: "List services" },
  args: { env: ENVIRONMENT_ARG, set: SET_ARG },
  async run({ args, rawArgs }) {
    const { config: declared, paths } = await openProject(args.env);
    const { config: reached, overrides } = await reachedServices(paths, declared);
    const config = applySelection(reached, selectionFrom(reached, rawArgs));
    if (Object.keys(config.services).length === 0) {
      console.log(noServices(paths));
      return;
    }
    // An added service is all local: marked without keys.
    const local = Object.fromEntries(
      Object.keys(config.services).flatMap((name) => {
        const keys = overriddenKeys(overrides, name);
        const added = !Object.hasOwn(declared.services, name);
        return keys.length > 0 || added ? [[name, keys]] : [];
      }),
    );
    console.log(formatServices(config, stdoutTerminal(), await readSkippedServices(paths), local));
  },
});
