import { defineCommand } from "citty";
import { curlCommand, curlNote } from "../checkers/http";
import { ENVIRONMENT_ARG, namedService, openProject } from "./shared";

export default defineCommand({
  meta: { name: "curl", description: "Print the curl command that requests a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
    env: ENVIRONMENT_ARG,
  },
  async run({ args }) {
    const { config } = await openProject(args.env);
    const service = namedService(config, args.name);
    console.log(curlCommand(service));
    // On stderr: `probe curl api | sh` must still run the command alone.
    const note = curlNote(service, process.env);
    if (note) console.error(`probe: ${note}`);
  },
});
