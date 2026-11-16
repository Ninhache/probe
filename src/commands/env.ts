import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { requireProbeDir } from "../config/discovery";
import { environmentPaths, listEnvironments } from "../config/environments";
import { SERVICE_NAME_PATTERN } from "../config/schema";
import { CONFIG_FILE, ENVIRONMENTS_DIR, LOCAL_ENVIRONMENT, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { linkFile } from "../ui/links";
import { openProject, stdoutTerminal } from "./shared";
import { usedVariables } from "./var";

const fileOf = (name: string) =>
  name === LOCAL_ENVIRONMENT
    ? `${PROBE_DIR}/${CONFIG_FILE}`
    : `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${name}.yml`;

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
  },
  async run({ args }) {
    const { name } = args;
    if (name === undefined) {
      if (args.from !== undefined) {
        throw new ProbeError(
          "USAGE",
          "--from expects the name to create: probe env prod --from dev",
        );
      }
      const paths = requireProbeDir(process.cwd());
      const found = await listEnvironments(paths);
      const names = [LOCAL_ENVIRONMENT, ...found];
      const width = Math.max(...names.map((known) => known.length));
      const { hyperlinks } = stdoutTerminal();
      for (const known of names) {
        const file = (await environmentPaths(paths, known)).config;
        console.log(`${known.padEnd(width)}  ${linkFile(fileOf(known), file, hyperlinks)}`);
      }
      return;
    }
    if (!SERVICE_NAME_PATTERN.test(name)) {
      throw new ProbeError(
        "USAGE",
        "an environment name is made of letters, digits, _ and -, e.g. prod.",
      );
    }
    if (name === LOCAL_ENVIRONMENT) {
      throw new ProbeError("USAGE", `${LOCAL_ENVIRONMENT} is ${fileOf(name)}: pick another name.`);
    }
    const from = args.from ?? LOCAL_ENVIRONMENT;
    const { config, paths } = await openProject(from);
    const target = join(paths.dir, ENVIRONMENTS_DIR, `${name}.yml`);
    await mkdir(dirname(target), { recursive: true });
    // Only the file that declares the services: what local.yml keeps for the source stays there.
    const text = await readFile(paths.config, "utf8");
    try {
      await writeFile(target, text, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new ProbeError(
        "USAGE",
        `${fileOf(name)} is already there: edit it, or pick another name.`,
      );
    }
    console.log(`Created ${fileOf(name)} from ${fileOf(from)}.`);
    console.log(`Change the addresses there, then: probe check --env ${name}`);
    for (const variable of usedVariables(config).keys()) {
      console.log(`It sends ${variable}: probe var ${variable} --env ${name} (or export it).`);
    }
  },
});
