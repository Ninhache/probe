import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { httpChecker } from "./checkers/http";
import type { RawConfig } from "./config/migrations";
import { SERVICE_NAME_PATTERN, serviceSchemaV1 } from "./config/schema";
import { DETECT_PORTS, DETECT_PORTS_ENV, DETECT_TIMEOUT_MS } from "./constants";

/** A service found in the project, not declared yet. */
export interface Candidate {
  name: string;
  /** The entry as it would be written to `config.yml`: defaults left out. */
  service: RawConfig;
  /** Where it was found, e.g. `.env (API_URL)`. Never holds a value read from a file. */
  source: string;
}

export interface DetectDeps {
  /** Returns the text of a file, or null when it cannot be read. */
  read: (path: string) => Promise<string | null>;
  /** Tells whether an HTTP server answers on that local port. */
  answers: (port: number) => Promise<boolean>;
  /** Local ports tried when no file names them. */
  ports: readonly number[];
}

const DEFAULT_HOST = "localhost";
const DEFAULT_NAME = "app";
const LOCAL_HOSTS = [DEFAULT_HOST, "127.0.0.1", "::1"];
// The check is an HTTP GET: databases, caches and brokers would always be reported down.
const NOT_HTTP_PORTS = [1433, 2181, 3306, 5432, 5672, 6379, 9092, 11211, 27017];
const ENV_FILES = [".env", ".env.local"];
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
const URL_KEY = /^(?:VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_)?(.*)_URL$/;
const SCRIPT_PORT = /(?:--port[= ]|-p |\bPORT=)(\d{2,5})\b/;
// Port a dev server listens on when its script names none.
const TOOL_PORTS: [tool: RegExp, port: number][] = [
  [/\bvite\b/, 5173],
  [/\bnext\b/, 3000],
  [/\bnuxt\b/, 3000],
  [/\bastro\b/, 4321],
  [/\bng serve\b/, 4200],
];
const MAIN_SCRIPTS = ["dev", "start", "serve"];

function serviceName(text: string): string {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return name || DEFAULT_NAME;
}

function unquoted(value: string): string {
  const quote = value[0];
  const quoted = (quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1;
  return quoted ? value.slice(1, -1) : value;
}

/** Keeps the host, port and path of a local http URL: credentials and query are dropped. */
function serviceOfUrl(value: string): RawConfig | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !LOCAL_HOSTS.includes(host)) return null;
  const service: RawConfig = { port: Number(url.port || 80) };
  if (host !== DEFAULT_HOST) service.host = host;
  if (url.pathname !== "/") service.path = url.pathname;
  return service;
}

function fromEnv(file: string, text: string): Candidate[] {
  const found: Candidate[] = [];
  for (const line of text.split("\n")) {
    const [, key, raw] = ENV_LINE.exec(line) ?? [];
    if (!key || raw === undefined) continue;
    const value = unquoted(raw);
    const source = `${file} (${key})`;
    const urlName = URL_KEY.exec(key)?.[1];
    if (key === "PORT" && /^\d+$/.test(value)) {
      found.push({ name: DEFAULT_NAME, service: { port: Number(value) }, source });
    } else if (urlName !== undefined) {
      const service = serviceOfUrl(value);
      if (service) found.push({ name: serviceName(urlName), service, source });
    }
  }
  return found;
}

function fromPackage(text: string): Candidate[] {
  let manifest: { name?: unknown; scripts?: unknown };
  try {
    manifest = JSON.parse(text);
  } catch {
    return [];
  }
  if (!manifest.scripts || typeof manifest.scripts !== "object") return [];
  const project = typeof manifest.name === "string" ? manifest.name.replace(/^@[^/]*\//, "") : "";
  const found: Candidate[] = [];
  for (const [script, command] of Object.entries(manifest.scripts)) {
    if (typeof command !== "string") continue;
    const main = MAIN_SCRIPTS.includes(script);
    const named = SCRIPT_PORT.exec(command)?.[1];
    const usual = main ? TOOL_PORTS.find(([tool]) => tool.test(command))?.[1] : undefined;
    const port = named ? Number(named) : usual;
    if (port === undefined) continue;
    const name = serviceName(main ? project : script);
    found.push({ name, service: { port }, source: `package.json (${script} script)` });
  }
  return found;
}

const address = (service: RawConfig) => `${service.host ?? DEFAULT_HOST}:${service.port}`;

/**
 * Looks for services the project already describes: `PORT` and `*_URL` in `.env`, ports in the scripts
 * of `package.json`, then local ports where an HTTP server answers.
 * Only what an HTTP check can reach is returned, without what `existing` already declares.
 * @param root directory of the project
 * @param existing services of `config.yml`, as written
 * @returns candidates with a free name and a valid entry, in the order of the sources
 */
export async function detectServices(
  root: string,
  existing: Record<string, RawConfig>,
  deps: DetectDeps,
): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const file of ENV_FILES) {
    const text = await deps.read(join(root, file));
    if (text !== null) found.push(...fromEnv(file, text));
  }
  const manifest = await deps.read(join(root, "package.json"));
  if (manifest !== null) found.push(...fromPackage(manifest));

  const names = new Set(Object.keys(existing));
  const addresses = new Set(Object.values(existing).map(address));
  const kept: Candidate[] = [];
  const keep = ({ name, service, source }: Candidate) => {
    const valid = serviceSchemaV1.safeParse(service).success && SERVICE_NAME_PATTERN.test(name);
    const checkable = !NOT_HTTP_PORTS.includes(service.port as number);
    if (!valid || !checkable || addresses.has(address(service))) return;
    let free = name;
    for (let suffix = 2; names.has(free); suffix++) free = `${name}-${suffix}`;
    names.add(free);
    addresses.add(address(service));
    kept.push({ name: free, service, source });
  };
  found.forEach(keep);

  const open = await Promise.all(
    deps.ports
      .filter((port) => !addresses.has(`${DEFAULT_HOST}:${port}`))
      .map(async (port) => ((await deps.answers(port)) ? port : null)),
  );
  for (const port of open) {
    if (port !== null) {
      keep({
        name: `port-${port}`,
        service: { port },
        source: `answers on ${DEFAULT_HOST}:${port}`,
      });
    }
  }
  return kept;
}

/** Ports to try: `PROBE_DETECT_PORTS` (comma-separated, empty for none) when set, else the usual ones. */
export function detectPorts(env: NodeJS.ProcessEnv): number[] {
  const listed = env[DETECT_PORTS_ENV];
  if (listed === undefined) return [...DETECT_PORTS];
  return listed
    .split(",")
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

/** The real sources: files on disk, and the HTTP checker with a short time limit. */
export function systemDeps(env: NodeJS.ProcessEnv): DetectDeps {
  return {
    read: (path) => readFile(path, "utf8").catch(() => null),
    answers: async (port) => {
      const service = serviceSchemaV1.parse({ port });
      const result = await httpChecker.check("", service, { timeoutMs: DETECT_TIMEOUT_MS });
      return result.status !== undefined;
    },
    ports: detectPorts(env),
  };
}
