import { defineCommand } from "citty";
import { ProbeError } from "../errors";
import { openProject, rawServices, saveServices } from "./shared";

export default defineCommand({
  meta: { name: "rm", description: "Remove a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
  },
  async run({ args }) {
    const loaded = await openProject();
    const { [args.name]: removed, ...rest } = rawServices(loaded);
    if (!removed) {
      throw new ProbeError("SERVICE_UNKNOWN", `unknown service "${args.name}". See: probe ls`);
    }
    await saveServices(loaded, rest);
    console.log(`Removed ${args.name}.`);
  },
});
