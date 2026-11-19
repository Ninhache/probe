import { isDeepStrictEqual } from "node:util";
import type { ProbePaths } from "../config/discovery";
import { loadConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
import { type Config, DEFAULT_METHOD, declaresAddress, type Service } from "../config/schema";
import { rawServices, writeServices } from "./shared";

/** No address at all: the service takes it from `urls:`, one per value of the `url` parameter. */
export type ServiceFields = Pick<Service, "url" | "expect" | "method" | "headers"> &
  Partial<Pick<Service, "host" | "port" | "path">>;

/** The address of a service for each value of the `url` parameter; an empty one is removed. */
export type ServiceUrls = Readonly<Record<string, string>>;

/** `env` names the environment whose file is written; absent, the write goes to config.yml. */
export type ServiceWrite =
  | { kind: "add"; name: string; fields: ServiceFields; urls?: ServiceUrls; env?: string }
  | { kind: "edit"; name: string; fields: ServiceFields; urls?: ServiceUrls; env?: string }
  | { kind: "remove"; name: string; env?: string };

export interface ServiceWritten {
  config: Config;
  warning?: string;
}

const DEFAULTS: Partial<ServiceFields> = {
  host: "localhost",
  path: "/",
  expect: undefined,
  method: DEFAULT_METHOD,
  headers: undefined,
};
const FIELD_KEYS = ["host", "port", "path", "expect", "method", "headers"] as const;

/** `expect: [200]` and `expect: 200` say the same: a form cannot tell which one was written. */
const sameValue = (a: unknown, b: unknown) => isDeepStrictEqual([a].flat(), [b].flat());

const ADDRESS_KEYS: readonly string[] = ["host", "port", "path"];

function withFields(service: RawConfig, fields: ServiceFields, current?: Service): RawConfig {
  const next = { ...service };
  // `url` says what host, port and path say: the config refuses both, one goes when the other comes.
  if (fields.url !== undefined) {
    if (fields.url !== service.url) next.url = fields.url;
  } else delete next.url;
  for (const key of FIELD_KEYS) {
    const address = ADDRESS_KEYS.includes(key);
    if (address && fields.url !== undefined) {
      delete next[key];
      continue;
    }
    // Read from a `url` or from `urls:`, they are not in the file: there is nothing to leave alone.
    const own = service.url === undefined && current !== undefined && declaresAddress(current);
    const was = address && !own ? undefined : current;
    // An edit leaves alone what it did not change, even a default written out by hand.
    const value = fields[key] ?? DEFAULTS[key];
    if (was && sameValue(value, was[key] ?? DEFAULTS[key])) continue;
    if (isDeepStrictEqual(value, DEFAULTS[key])) delete next[key];
    else next[key] = fields[key];
  }
  return next;
}

function withUrls(service: RawConfig, urls: ServiceUrls | undefined): RawConfig {
  if (!urls) return service;
  const kept: Record<string, unknown> = { ...(service.urls as RawConfig | undefined) };
  for (const [value, address] of Object.entries(urls)) {
    if (address) kept[value] = address;
    else delete kept[value];
  }
  const next: RawConfig = { ...service, urls: kept };
  if (Object.keys(kept).length === 0) delete next.urls;
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
  const next =
    write.kind === "remove"
      ? others
      : {
          ...services,
          [write.name]: withUrls(
            withFields(previous ?? {}, write.fields, loaded.config.services[write.name]),
            write.urls,
          ),
        };
  const { saved, warning } = await writeServices(loaded, next);
  return { config: saved.config, warning };
}
