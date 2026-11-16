import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ENVIRONMENTS_DIR, LOCAL_ENVIRONMENT, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import type { ProbePaths } from "./discovery";
import { SERVICE_NAME_PATTERN } from "./schema";

const EXTENSION = ".yml";

export async function listEnvironments(paths: ProbePaths): Promise<string[]> {
  const files = await readdir(join(paths.dir, ENVIRONMENTS_DIR)).catch(() => []);
  return files
    .filter((file) => file.endsWith(EXTENSION))
    .map((file) => file.slice(0, -EXTENSION.length))
    .filter((name) => SERVICE_NAME_PATTERN.test(name) && name !== LOCAL_ENVIRONMENT)
    .sort();
}

export async function environmentPaths(
  paths: ProbePaths,
  name: string | undefined,
): Promise<ProbePaths> {
  if (name === undefined || name === LOCAL_ENVIRONMENT) return paths;
  // The name ends up in a path: nothing that could leave `envs/` gets there.
  if (!SERVICE_NAME_PATTERN.test(name)) {
    throw new ProbeError("USAGE", "--env expects a name made of letters, digits, _ and -.");
  }
  const found = await listEnvironments(paths);
  if (!found.includes(name)) {
    const file = `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${name}${EXTENSION}`;
    const known = [LOCAL_ENVIRONMENT, ...found].join(", ");
    throw new ProbeError(
      "ENVIRONMENT_UNKNOWN",
      `no environment "${name}" (known: ${known}). Declare it in ${file}, written like config.yml.`,
    );
  }
  return {
    ...paths,
    config: join(paths.dir, ENVIRONMENTS_DIR, `${name}${EXTENSION}`),
    environment: name,
  };
}
