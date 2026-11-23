import { defineCommand } from "citty";
import { readServiceOverrides, removeServiceEntry } from "../config/local";
import { extraAt } from "../config/overrides";
import { LOCAL_FILE, PROBE_DIR } from "../constants";
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
    const local = await readServiceOverrides(loaded.paths);
    if (!Object.hasOwn(services, args.name) && Object.hasOwn(local.extra ?? {}, args.name)) {
      throw new ProbeError(
        "USAGE",
        `${args.name} is only in ${PROBE_DIR}/${LOCAL_FILE}, under ${extraAt(local)}: remove it there.`,
      );
    }
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
    // Left there, its values would be told unused at every check.
    const tracked =
      Object.hasOwn(local.services, args.name) || local.skipped?.includes(args.name) === true;
    const cleared = tracked && (await removeServiceEntry(loaded.paths, args.name));
    console.log(
      cleared
        ? `Removed ${args.name}, and its values in ${PROBE_DIR}/${LOCAL_FILE}.`
        : `Removed ${args.name}.`,
    );
  },
});
