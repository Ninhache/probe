import { defineCommand } from "citty";
import { serviceType } from "../checkers/registry";
import { applySelection } from "../config/parameters";
import { ProbeError } from "../errors";
import { ENVIRONMENT_ARG, namedService, openProject, SET_ARG, selectionFrom } from "./shared";

export default defineCommand({
  meta: { name: "curl", description: "Print the curl command of a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
    env: ENVIRONMENT_ARG,
    set: SET_ARG,
  },
  async run({ args, rawArgs }) {
    const { config } = await openProject(args.env);
    const selected = applySelection(config, selectionFrom(config, rawArgs));
    const service = namedService(selected, args.name);
    const { copy } = serviceType(service);
    if (!copy) throw new ProbeError("USAGE", `${args.name} is not requested with curl.`);
    const { command, note } = copy(service, process.env);
    console.log(command);
    // On stderr: `probe curl api | sh` must still run the command alone.
    if (note) console.error(`probe: ${note}`);
  },
});
