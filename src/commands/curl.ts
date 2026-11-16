import { defineCommand } from "citty";
import { curlCommand, curlNote } from "../checkers/http";
import { applySelection } from "../config/parameters";
import { ENVIRONMENT_ARG, namedService, openProject, SET_ARG, selectionFrom } from "./shared";

export default defineCommand({
  meta: { name: "curl", description: "Print the curl command that requests a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
    env: ENVIRONMENT_ARG,
    set: SET_ARG,
  },
  async run({ args, rawArgs }) {
    const { config } = await openProject(args.env);
    const selected = applySelection(config, selectionFrom(config, rawArgs));
    const service = namedService(selected, args.name);
    console.log(curlCommand(service));
    // On stderr: `probe curl api | sh` must still run the command alone.
    const note = curlNote(service, process.env);
    if (note) console.error(`probe: ${note}`);
  },
});
