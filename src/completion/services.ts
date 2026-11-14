import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { findProbeDir } from "../config/discovery";
import { SERVICE_NAME_PATTERN } from "../config/schema";

/**
 * Names of the services of the project around `cwd`, for the shell completion.
 * Reads `config.yml` as it is: no migration, no validation, nothing written. Outside a project, or with a
 * config that cannot be read, there is nothing to complete: returns an empty list, never throws.
 * A shell expands the words it is given, so a key that is not a valid service name is left out.
 */
export async function completableServices(cwd: string): Promise<string[]> {
  try {
    const paths = findProbeDir(cwd);
    if (!paths) return [];
    const raw: unknown = parse(await readFile(paths.config, "utf8"));
    const services = (raw as { services?: unknown } | null)?.services;
    if (typeof services !== "object" || services === null) return [];
    return Object.keys(services).filter((name) => SERVICE_NAME_PATTERN.test(name));
  } catch {
    return [];
  }
}
