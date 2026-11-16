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

async function declaredServices(cwd: string): Promise<Record<string, unknown>> {
  try {
    const paths = findProbeDir(cwd);
    if (!paths) return {};
    const raw: unknown = parse(await readFile(paths.config, "utf8"));
    const services = (raw as { services?: unknown } | null)?.services;
    return typeof services === "object" && services !== null ? { ...services } : {};
  } catch {
    return {};
  }
}

// A shell expands the words it is given: a key that is not a valid service name is left out.
export async function completableServices(cwd: string): Promise<string[]> {
  return Object.keys(await declaredServices(cwd)).filter((name) => SERVICE_NAME_PATTERN.test(name));
}

export async function completableTags(cwd: string): Promise<string[]> {
  const tags = Object.values(await declaredServices(cwd)).flatMap((service) => {
    const own = (service as { tags?: unknown } | null)?.tags;
    return Array.isArray(own) ? own : [];
  });
  return [...new Set(tags)].filter(
    (tag): tag is string => typeof tag === "string" && SERVICE_NAME_PATTERN.test(tag),
  );
}
