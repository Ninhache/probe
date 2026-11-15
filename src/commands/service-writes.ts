import { isDeepStrictEqual } from "node:util";
import type { ProbePaths } from "../config/discovery";
import { loadConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
import type { Config, Service } from "../config/schema";
import { rawServices, writeServices } from "./shared";

export type ServiceFields = Pick<Service, "host" | "port" | "path" | "expect">;

export type ServiceWrite =
  | { kind: "add"; name: string; fields: ServiceFields }
  | { kind: "edit"; name: string; fields: ServiceFields }
  | { kind: "remove"; name: string };

export interface ServiceWritten {
  config: Config;
  warning?: string;
}

const DEFAULTS: Partial<ServiceFields> = { host: "localhost", path: "/", expect: undefined };
const FIELD_KEYS = ["host", "port", "path", "expect"] as const;

/** `expect: [200]` and `expect: 200` say the same: a form cannot tell which one was written. */
const sameValue = (a: unknown, b: unknown) => isDeepStrictEqual([a].flat(), [b].flat());

function withFields(service: RawConfig, fields: ServiceFields, current?: ServiceFields): RawConfig {
  const next = { ...service };
  for (const key of FIELD_KEYS) {
    // An edit leaves alone what it did not change, even a default written out by hand.
    if (current && sameValue(fields[key], current[key])) continue;
    if (isDeepStrictEqual(fields[key], DEFAULTS[key])) delete next[key];
    else next[key] = fields[key];
  }
  return next;
}

// The file is read again first: an edit made since the caller loaded it is kept.
export async function writeService(
  paths: ProbePaths,
  write: ServiceWrite,
): Promise<ServiceWritten | null> {
  const loaded = await loadConfig(paths);
  const services = rawServices(loaded);
  const exists = Object.hasOwn(services, write.name);
  if (exists === (write.kind === "add")) return null;
  const { [write.name]: previous, ...others } = services;
  if (write.kind === "edit" && previous?.url !== undefined) return null;
  const next =
    write.kind === "remove"
      ? others
      : {
          ...services,
          [write.name]: withFields(
            previous ?? {},
            write.fields,
            loaded.config.services[write.name],
          ),
        };
  const { saved, warning } = await writeServices(loaded, next);
  return { config: saved.config, warning };
}
