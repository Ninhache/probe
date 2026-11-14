import { defineCommand } from "citty";
import { ProbeError } from "../errors";
import { confirm } from "../ui/prompt";
import { isInteractive } from "../ui/terminal";
import { openProject, rawServices, saveServices } from "./shared";

export default defineCommand({
  meta: { name: "rm", description: "Remove a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
    yes: { type: "boolean", alias: "y", description: "Remove without asking" },
  },
  async run({ args }) {
    const loaded = await openProject();
    const services = rawServices(loaded);
    if (!Object.hasOwn(services, args.name)) {
      throw new ProbeError("SERVICE_UNKNOWN", `unknown service "${args.name}". See: probe ls`);
    }
    // Off a terminal nobody can answer: scripts and CI keep removing at once.
    const asks = !args.yes && isInteractive(process.stdin, process.stdout, process.env);
    if (asks && !(await confirm(`Remove ${args.name}?`))) {
      console.log("Nothing removed.");
      return;
    }
    const { [args.name]: _removed, ...rest } = services;
    await saveServices(loaded, rest);
    console.log(`Removed ${args.name}.`);
  },
});
