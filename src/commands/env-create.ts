import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProbePaths } from "../config/discovery";
import { environmentPaths } from "../config/environments";
import { loadConfig } from "../config/loader";
import { CURRENT_SCHEMA_VERSION, SERVICE_NAME_PATTERN } from "../config/schema";
import { CONFIG_FILE, ENVIRONMENTS_DIR, LOCAL_ENVIRONMENT, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { usedVariables } from "./var";

/** Stands for "no source" where an environment is created: it is not the name of an environment. */
export const EMPTY_ENVIRONMENT = Symbol("empty environment");

/** The file an environment is declared in, relative to the project. */
export const environmentFile = (name: string) =>
  name === LOCAL_ENVIRONMENT
    ? `${PROBE_DIR}/${CONFIG_FILE}`
    : `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${name}.yml`;

/** Why `name` cannot be the name of a new environment, if it cannot. */
export function environmentNameProblem(name: string): string | undefined {
  if (!SERVICE_NAME_PATTERN.test(name))
    return "an environment name is made of letters, digits, _ and -, e.g. prod.";
  if (name === LOCAL_ENVIRONMENT)
    return `${LOCAL_ENVIRONMENT} is ${environmentFile(name)}: pick another name.`;
  return undefined;
}

export interface CreatedEnvironment {
  /** The variables the copied services send: each still needs a value for the new environment. */
  variables: string[];
}

/** What an environment is created from: another environment's file, or nothing. */
export type EnvironmentOrigin = string | typeof EMPTY_ENVIRONMENT;

/** The file of an environment with no service: the schema version and nothing else. */
const EMPTY_FILE = `schemaVersion: ${CURRENT_SCHEMA_VERSION}\nservices: {}\n`;

/**
 * Creates `.probe/envs/<name>.yml` as a copy of the file that declares the services of `from`,
 * or with no service at all when `from` is `EMPTY_ENVIRONMENT`.
 * Only that file is copied: what local.yml keeps for the source, secret values included, stays there.
 * Throws a `ProbeError` when the name is refused, the source unknown or the file already there.
 */
export async function createEnvironment(
  paths: ProbePaths,
  name: string,
  from: EnvironmentOrigin = LOCAL_ENVIRONMENT,
): Promise<CreatedEnvironment> {
  const problem = environmentNameProblem(name);
  if (problem) throw new ProbeError("USAGE", problem);
  const empty = from === EMPTY_ENVIRONMENT;
  const source = empty ? undefined : await environmentPaths(paths, from);
  const config = source && (await loadConfig(source)).config;
  const target = join(paths.dir, ENVIRONMENTS_DIR, `${name}.yml`);
  await mkdir(dirname(target), { recursive: true });
  const text = source ? await readFile(source.config, "utf8") : EMPTY_FILE;
  try {
    await writeFile(target, text, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new ProbeError(
      "USAGE",
      `${environmentFile(name)} is already there: edit it, or pick another name.`,
    );
  }
  return { variables: config ? [...usedVariables(config).keys()] : [] };
}
