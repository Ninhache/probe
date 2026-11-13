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
    const services = rawServices(loaded);
    if (!Object.hasOwn(services, args.name)) {
      throw new ProbeError("SERVICE_UNKNOWN", `unknown service "${args.name}". See: probe ls`);
    }
    const { [args.name]: _removed, ...rest } = services;
    await saveServices(loaded, rest);
    console.log(`Removed ${args.name}.`);
  },
});
