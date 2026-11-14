import type { RawConfig } from "../config/migrations";

export const DEFAULT_HOST = "localhost";
export const DEFAULT_NAME = "app";

// The check is a plain HTTP GET: mail servers, https, databases, caches and brokers would always
// be reported down.
const NOT_HTTP_PORTS = [
  25, 443, 465, 587, 1025, 1433, 2181, 3306, 5432, 5672, 6379, 8443, 9092, 11211, 27017,
];

export const isHttpPort = (port: number) => !NOT_HTTP_PORTS.includes(port);

export const address = (service: RawConfig) => `${service.host ?? DEFAULT_HOST}:${service.port}`;

/** Turns any text (a script name, a variable name) into a valid service name. */
export function serviceName(text: string): string {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return name || DEFAULT_NAME;
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquoted(value: string): string {
  const quote = value[0];
  const quoted = (quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1;
  return quoted ? value.slice(1, -1) : value;
}

/** Reads the `KEY=value` lines of a dotenv file, in order. */
export function parseEnvFile(text: string): [key: string, value: string][] {
  const entries: [string, string][] = [];
  for (const line of text.split("\n")) {
    const [, key, raw] = ENV_LINE.exec(line) ?? [];
    if (key && raw !== undefined) entries.push([key, unquoted(raw)]);
  }
  return entries;
}
