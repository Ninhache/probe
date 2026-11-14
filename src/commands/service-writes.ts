import { isDeepStrictEqual } from "node:util";
import type { ProbePaths } from "../config/discovery";
import { loadConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
import type { Config, Service } from "../config/schema";
import { rawServices, writeServices } from "./shared";

/** What the dashboard lets one set on a service; `timeout` has its own panel. */
export type ServiceFields = Pick<Service, "host" | "port" | "path" | "expect">;

export type ServiceWrite =
  | { kind: "add"; name: string; fields: ServiceFields }
  | { kind: "edit"; name: string; fields: ServiceFields }
  | { kind: "remove"; name: string };

export interface ServiceWritten {
  /** The config as it is now in `config.yml`. */
  config: Config;
  /** Something to tell the user, when the Makefile block could not follow. */
  warning?: string;
}

const DEFAULTS: Partial<ServiceFields> = { host: "localhost", path: "/", expect: undefined };
const FIELD_KEYS = ["host", "port", "path", "expect"] as const;

/** The keys to write for `fields`: a value at its default is left out, as `probe add` does. */
function withFields(service: RawConfig, fields: ServiceFields, current?: ServiceFields): RawConfig {
  const next = { ...service };
  for (const key of FIELD_KEYS) {
    // An edit leaves alone what it did not change, even a default written out by hand.
    if (current && isDeepStrictEqual(fields[key], current[key])) continue;
    if (isDeepStrictEqual(fields[key], DEFAULTS[key])) delete next[key];
    else next[key] = fields[key];
  }
  return next;
}

/**
 * Adds, edits or removes one service in `config.yml`, the way `probe add` and `probe rm` do:
 * comments kept, Makefile block regenerated when the project has one.
 * The file is read again first, so an edit made since the caller loaded it is kept.
 * Returns null, writing nothing, when the service to add is already there, or the one to edit or
 * remove no longer is.
 */
export async function writeService(
  paths: ProbePaths,
  write: ServiceWrite,
): Promise<ServiceWritten | null> {
  const loaded = await loadConfig(paths);
  const services = rawServices(loaded);
  const exists = Object.hasOwn(services, write.name);
  if (exists === (write.kind === "add")) return null;
  const { [write.name]: previous, ...others } = services;
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
