import { defineCommand } from "citty";
import { requireProbeDir } from "../config/discovery";
import { environmentPaths, listEnvironments } from "../config/environments";
import { LOCAL_ENVIRONMENT } from "../constants";
import { ProbeError } from "../errors";
import { linkFile } from "../ui/links";
import { createEnvironment, EMPTY_ENVIRONMENT, environmentFile } from "./env-create";
import { stdoutTerminal } from "./shared";

export default defineCommand({
  meta: {
    name: "env",
    description: "List the environments, or create one from the services of another",
  },
  args: {
    name: { type: "positional", description: "Environment to create, e.g. prod", required: false },
    from: {
      type: "string",
      valueHint: "name",
      description: `Environment whose services are copied (default: ${LOCAL_ENVIRONMENT})`,
    },
    empty: {
      type: "boolean",
      description: "Create it with no service, instead of copying one (conflicts with --from)",
    },
  },
  async run({ args }) {
    const { name } = args;
    if (name === undefined) {
      if (args.from !== undefined || args.empty) {
        throw new ProbeError(
          "USAGE",
          "--from and --empty expect the name to create: probe env prod --from dev",
        );
      }
      const paths = requireProbeDir(process.cwd());
      const found = await listEnvironments(paths);
      const names = [LOCAL_ENVIRONMENT, ...found];
      const width = Math.max(...names.map((known) => known.length));
      const { hyperlinks } = stdoutTerminal();
      for (const known of names) {
        const file = (await environmentPaths(paths, known)).config;
        console.log(
          `${known.padEnd(width)}  ${linkFile(environmentFile(known), file, hyperlinks)}`,
        );
      }
      return;
    }
    if (args.empty && args.from !== undefined)
      throw new ProbeError(
        "USAGE",
        "--empty and --from conflict: an empty environment copies nothing",
      );
    const from = args.from ?? LOCAL_ENVIRONMENT;
    const paths = requireProbeDir(process.cwd());
    if (args.empty) {
      await createEnvironment(paths, name, EMPTY_ENVIRONMENT);
      console.log(`Created ${environmentFile(name)}, with no service.`);
      console.log(`Add services there, then: probe check --env ${name}`);
      return;
    }
    const { variables } = await createEnvironment(paths, name, from);
    console.log(`Created ${environmentFile(name)} from ${environmentFile(from)}.`);
    console.log(`Change the addresses there, then: probe check --env ${name}`);
    for (const variable of variables) {
      console.log(`It sends ${variable}: probe var ${variable} --env ${name} (or export it).`);
    }
  },
});
