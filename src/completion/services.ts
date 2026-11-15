import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { findProbeDir } from "../config/discovery";
import { listEnvironments } from "../config/environments";
import { SERVICE_NAME_PATTERN } from "../config/schema";
import { LOCAL_ENVIRONMENT } from "../constants";

export async function completableEnvironments(cwd: string): Promise<string[]> {
  const paths = findProbeDir(cwd);
  return paths ? [LOCAL_ENVIRONMENT, ...(await listEnvironments(paths))] : [];
}

// A shell expands the words it is given: a key that is not a valid service name is left out.
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
