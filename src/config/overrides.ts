import { z } from "zod";
import { LOCAL_FILE, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { formatIssues } from "./migrations";
import {
  ADDRESS_KEYS,
  type Config,
  declaresAddress,
  type Service,
  serviceSchemaV1,
  serviceShapeV1,
} from "./schema";

/** The keys local.yml may give a service of config.yml: where it is reached on this machine. */
export const OVERRIDE_KEYS = [
  "url",
  "host",
  "port",
  "path",
  "timeout",
  "command",
  "user",
  "database",
] as const;

export type OverrideKey = (typeof OVERRIDE_KEYS)[number];

/** The values local.yml gives each service, as written there: they are checked once merged. */
export interface ServiceOverrides {
  /** Where they sit in local.yml, `services` or `envs.<name>.services`: said in the problems. */
  at: string;
  services: Readonly<Record<string, Readonly<Partial<Record<OverrideKey, unknown>>>>>;
}

export const NO_OVERRIDES: ServiceOverrides = { at: "services", services: {} };

const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;

const isOverrideKey = (key: string): key is OverrideKey =>
  (OVERRIDE_KEYS as readonly string[]).includes(key);

/** The keys of a service that local.yml sets, in the order of OVERRIDE_KEYS. */
export const overriddenKeys = (overrides: ServiceOverrides, name: string): OverrideKey[] => {
  const own = Object.hasOwn(overrides.services, name) ? overrides.services[name] : undefined;
  return own ? OVERRIDE_KEYS.filter((key) => own[key] !== undefined) : [];
};

export function refusedOverrideKey(at: string, name: string, key: string): ProbeError {
  return new ProbeError(
    "CONFIG_INVALID",
    `${LOCAL}: ${at}.${name}.${key} cannot be set there: local.yml sets only ${OVERRIDE_KEYS.join(", ")}, the rest is in the shared config.`,
  );
}

type Override = Readonly<Partial<Record<OverrideKey, unknown>>>;

/** The service as its file writes it, read back by the schema to the same service. */
function asWritten(service: Service, override: Override): Record<string, unknown> {
  const written: Record<string, unknown> = { ...service };
  // host, port and path come from `url`, or from `urls:`: kept then only when local.yml sets one of them.
  const fromUrls = !declaresAddress(service);
  const setsAddress = ADDRESS_KEYS.some((key) => override[key] !== undefined);
  if (service.url !== undefined || (fromUrls && !setsAddress)) {
    for (const key of ADDRESS_KEYS) delete written[key];
  }
  return written;
}

const pathAndSearch = (path: string): [string, string] => {
  const at = path.indexOf("?");
  return at === -1 ? [path, ""] : [path.slice(0, at), path.slice(at)];
};

// A `url` in config.yml stays one: host, port or path from local.yml change it, its scheme kept.
function withAddress(url: string, { host, port, path }: Override): string {
  const next = new URL(url);
  if (host !== undefined) next.hostname = String(host);
  if (port !== undefined) next.port = String(port);
  if (path !== undefined) [next.pathname, next.search] = pathAndSearch(String(path));
  return next.href;
}

function merged(service: Service, override: Override): Record<string, unknown> {
  const next = asWritten(service, override);
  const { url, ...others } = override;
  const address = ADDRESS_KEYS.filter((key) => override[key] !== undefined);
  // `url` says what host, port and path say: the one local.yml gives replaces the other.
  if (url !== undefined) {
    for (const key of ADDRESS_KEYS) delete next[key];
    next.url = url;
  } else if (address.length > 0 && typeof next.url === "string") {
    next.url = withAddress(next.url, override);
    for (const key of address) delete others[key];
  }
  return { ...next, ...others };
}

// Each value alone first: a host, port or path folded into a url would no longer be named.
function valueProblems(override: Override): z.core.$ZodIssue[] {
  return OVERRIDE_KEYS.flatMap((key) => {
    if (override[key] === undefined) return [];
    const checked = serviceShapeV1[key].safeParse(override[key]);
    return checked.success
      ? []
      : checked.error.issues.map((issue) => ({ ...issue, path: [key, ...issue.path] }));
  });
}

function problem(at: string, name: string, issues: readonly z.core.$ZodIssue[]): ProbeError {
  // The messages of the schema name the key, never the value: it stays on this machine.
  return new ProbeError(
    "CONFIG_INVALID",
    `${LOCAL} is invalid:\n${formatIssues(new z.ZodError([...issues]), `${at}.${name}.`)}`,
  );
}

/**
 * The services as this machine reaches them: config.yml with the values of local.yml.
 * The result is read, never written: config.yml, the Makefile and lock.yml do not see it.
 * @throws ProbeError CONFIG_INVALID when local.yml names a service the config does not have,
 *   or gives a value the service cannot take.
 */
export function withOverrides(config: Config, overrides: ServiceOverrides = NO_OVERRIDES): Config {
  const names = Object.keys(overrides.services);
  if (names.length === 0) return config;
  const services = { ...config.services };
  for (const name of names) {
    const override = overrides.services[name] ?? {};
    const keys = Object.keys(override);
    const refused = keys.find((key) => !isOverrideKey(key));
    if (refused !== undefined) throw refusedOverrideKey(overrides.at, name, refused);
    const service = Object.hasOwn(services, name) ? services[name] : undefined;
    if (!service) {
      throw new ProbeError(
        "CONFIG_INVALID",
        `${LOCAL}: ${overrides.at}.${name} overrides a service the config does not have: remove it, or add the service.`,
      );
    }
    const issues = valueProblems(override);
    if (issues.length > 0) throw problem(overrides.at, name, issues);
    const parsed = serviceSchemaV1.safeParse(merged(service, override));
    if (!parsed.success) throw problem(overrides.at, name, parsed.error.issues);
    services[name] = parsed.data;
  }
  return { ...config, services };
}
