import { z } from "zod";
import { LOCAL_FILE, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { formatIssues } from "./migrations";
import {
  ADDRESS_KEYS,
  type Config,
  declaresAddress,
  NAME_EXPECTED,
  SERVICE_NAME_PATTERN,
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
  /** The services only this machine has, under `extraServices` next to `services`, as written. */
  extra?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** The services local.yml skips: a name config.yml no longer has is told about too. */
  skipped?: readonly string[];
}

export const NO_OVERRIDES: ServiceOverrides = { at: "services", services: {} };

const SERVICES = "services";
export const EXTRA_SERVICES = "extraServices";

/** Where the added services sit in local.yml: `extraServices`, or under the environment. */
export const extraAt = (overrides: ServiceOverrides): string =>
  `${overrides.at.slice(0, -SERVICES.length)}${EXTRA_SERVICES}`;

/** What local.yml says of services config.yml has changed since: names only, never a value. */
export interface LocalMismatches {
  /** Under `services`: config.yml no longer has them, their values are unused. */
  unused: string[];
  /** Under `extraServices`: config.yml has them now, and the shared one is checked. */
  shadowed: string[];
}

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
function withAddress(url: string, { host, port, path }: Override): string | undefined {
  const next = new URL(url);
  if (host !== undefined) {
    next.hostname = String(host);
    // The setter leaves the host as it was on one it cannot take, such as `localhost:4000`.
    const wanted = String(host).toLowerCase();
    if (next.hostname !== wanted && next.hostname !== `[${wanted}]`) return undefined;
  }
  if (port !== undefined) next.port = String(port);
  if (path !== undefined) [next.pathname, next.search] = pathAndSearch(String(path));
  return next.href;
}

const HOST_EXPECTED = "expected a host name alone, e.g. localhost";

function merged(service: Service, override: Override): Record<string, unknown> | undefined {
  const next = asWritten(service, override);
  const { url, ...others } = override;
  const address = ADDRESS_KEYS.filter((key) => override[key] !== undefined);
  // `url` says what host, port and path say: the one local.yml gives replaces the other.
  if (url !== undefined) {
    for (const key of ADDRESS_KEYS) delete next[key];
    next.url = url;
  } else if (address.length > 0 && typeof next.url === "string") {
    const url = withAddress(next.url, override);
    if (url === undefined) return undefined;
    next.url = url;
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

function problem(prefix: string, issues: readonly z.core.$ZodIssue[]): ProbeError {
  // The messages of the schema name the key, never the value: it stays on this machine.
  return new ProbeError(
    "CONFIG_INVALID",
    `${LOCAL} is invalid:\n${formatIssues(new z.ZodError([...issues]), prefix)}`,
  );
}

const custom = (path: string[], message: string): z.core.$ZodIssue => ({
  code: "custom",
  path,
  message,
  input: undefined,
});

// `urls:` follows a parameter of the shared config: a service of this machine has its own address.
const URLS_REFUSED = "cannot be set there: give a service of local.yml its own url or port";

function added(at: string, name: string, written: Readonly<Record<string, unknown>>): Service {
  if (!SERVICE_NAME_PATTERN.test(name)) throw problem(`${at}.`, [custom([name], NAME_EXPECTED)]);
  if (Object.hasOwn(written, "urls"))
    throw problem(`${at}.${name}.`, [custom(["urls"], URLS_REFUSED)]);
  const parsed = serviceSchemaV1.safeParse(written);
  if (!parsed.success) throw problem(`${at}.${name}.`, parsed.error.issues);
  return parsed.data;
}

/** The entries of local.yml that no longer match config.yml. Pure: the caller says it where it fits. */
export function localMismatches(config: Config, overrides: ServiceOverrides): LocalMismatches {
  const shared = (name: string) => Object.hasOwn(config.services, name);
  const extra = Object.keys(overrides.extra ?? {});
  const tracked = new Set([...Object.keys(overrides.services), ...(overrides.skipped ?? [])]);
  return {
    unused: [...tracked].filter((name) => !shared(name) && !extra.includes(name)).sort(),
    shadowed: extra.filter(shared).sort(),
  };
}

/** One line for each mismatch, naming `file`, the shared config the services were read from. */
export function mismatchMessages(
  overrides: ServiceOverrides,
  { unused, shadowed }: LocalMismatches,
  file: string,
): string[] {
  return [
    ...unused.map(
      (name) =>
        `${LOCAL_FILE}: ${overrides.at}.${name} is no longer in ${file}: its values are unused. Remove them from ${LOCAL}.`,
    ),
    ...shadowed.map(
      (name) =>
        `${LOCAL_FILE}: ${extraAt(overrides)}.${name} is now in ${file} too: the shared one is checked. Move what differs to ${overrides.at}.${name}, or remove it.`,
    ),
  ];
}

/**
 * The services as this machine reaches them: config.yml with the values and the services of local.yml.
 * The result is read, never written: config.yml, the Makefile and lock.yml do not see it.
 * A service config.yml no longer has is left out, as `skip` is; one it has now beats the added one.
 * @throws ProbeError CONFIG_INVALID when local.yml sets a key it cannot, or a value the service cannot take.
 */
export function withOverrides(config: Config, overrides: ServiceOverrides = NO_OVERRIDES): Config {
  const names = Object.keys(overrides.services);
  const extra = Object.entries(overrides.extra ?? {});
  if (names.length === 0 && extra.length === 0) return config;
  const services = { ...config.services };
  for (const [name, written] of extra) {
    if (!Object.hasOwn(config.services, name))
      services[name] = added(extraAt(overrides), name, written);
  }
  for (const name of names) {
    const override = overrides.services[name] ?? {};
    const keys = Object.keys(override);
    const refused = keys.find((key) => !isOverrideKey(key));
    if (refused !== undefined) throw refusedOverrideKey(overrides.at, name, refused);
    // As for `skip`: a service removed from config.yml leaves its values behind, unused.
    const service = Object.hasOwn(services, name) ? services[name] : undefined;
    if (!service) continue;
    const issues = valueProblems(override);
    const prefix = `${overrides.at}.${name}.`;
    if (issues.length > 0) throw problem(prefix, issues);
    const next = merged(service, override);
    if (next === undefined) throw problem(prefix, [custom(["host"], HOST_EXPECTED)]);
    const parsed = serviceSchemaV1.safeParse(next);
    if (!parsed.success) throw problem(prefix, parsed.error.issues);
    services[name] = parsed.data;
  }
  return { ...config, services };
}
