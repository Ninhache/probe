import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawConfig } from "../config/migrations";
import { SERVICE_NAME_PATTERN, serviceSchemaV1 } from "../config/schema";
import { allSources } from "./registry";
import { address, isHttpPort } from "./shared";
import { answersHttp, detectPorts } from "./sources/ports";
import type { Candidate, Source } from "./types";

export type { Candidate, Source, SourceContext } from "./types";

export interface DetectDeps {
  /** Returns the text of a file by its absolute path, or null when it cannot be read. */
  read: (path: string) => Promise<string | null>;
  /** The places to look at, in order. */
  sources: readonly Source[];
}

/**
 * Asks each source, in order, for the services the project already describes.
 * Keeps only what the config schema accepts, an HTTP check can reach and `existing` does not
 * declare yet; a name already taken gets a suffix.
 * @param root directory of the project
 * @param existing services of `config.yml`, as written
 * @returns the candidates, in the order of the sources
 */
export async function detectServices(
  root: string,
  existing: Record<string, RawConfig>,
  { read, sources }: DetectDeps,
): Promise<Candidate[]> {
  const names = new Set(Object.keys(existing));
  const addresses = new Set(Object.values(existing).map(address));
  const kept: Candidate[] = [];
  const context = {
    read: (file: string) => read(join(root, file)),
    isKnown: (service: RawConfig) => addresses.has(address(service)),
  };
  for (const source of sources) {
    for (const { name, service, source: origin } of await source.find(context)) {
      const valid = serviceSchemaV1.safeParse(service).success && SERVICE_NAME_PATTERN.test(name);
      if (!valid || !isHttpPort(service.port as number) || context.isKnown(service)) continue;
      let free = name;
      for (let suffix = 2; names.has(free); suffix++) free = `${name}-${suffix}`;
      names.add(free);
      addresses.add(address(service));
      kept.push({ name: free, service, source: origin });
    }
  }
  return kept;
}

/** The real thing: files on disk, every source, and the ports `PROBE_DETECT_PORTS` or the defaults name. */
export function systemDeps(env: NodeJS.ProcessEnv): DetectDeps {
  return {
    read: (path) => readFile(path, "utf8").catch(() => null),
    sources: allSources({ ports: detectPorts(env), answers: answersHttp }),
  };
}
