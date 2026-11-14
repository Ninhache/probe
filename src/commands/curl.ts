import { defineCommand } from "citty";
import { curlCommand } from "../checkers/http";
import { namedService, openProject } from "./shared";

export default defineCommand({
  meta: { name: "curl", description: "Print the curl command that requests a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
  },
  async run({ args }) {
    const { config } = await openProject();
    console.log(curlCommand(namedService(config, args.name)));
  },
});
