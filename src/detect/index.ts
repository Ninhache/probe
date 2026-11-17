import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawConfig } from "../config/migrations";
import { SERVICE_NAME_PATTERN, serviceSchemaV1 } from "../config/schema";
import { SOURCES } from "./registry";
import { address, isHttpPort, knownAddresses } from "./shared";
import { answersHttp, detectPorts } from "./sources/ports";
import type { Candidate, Machine, Source } from "./types";

export type { Candidate, Machine, Source, SourceContext } from "./types";

export interface DetectDeps extends Machine {
  read: (path: string) => Promise<string | null>;
  sources: readonly Source[];
}

export async function detectServices(
  root: string,
  existing: Record<string, RawConfig>,
  { read, sources, ports, answers }: DetectDeps,
): Promise<Candidate[]> {
  const names = new Set(Object.keys(existing));
  const addresses = new Set(Object.values(existing).flatMap(knownAddresses));
  const kept: Candidate[] = [];
  const context = {
    ports,
    answers,
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

export function systemDeps(env: NodeJS.ProcessEnv): DetectDeps {
  return {
    read: (path) => readFile(path, "utf8").catch(() => null),
    sources: SOURCES,
    ports: detectPorts(env),
    answers: answersHttp,
  };
}
