import type { z } from "zod";
import {
  CONTAINS_EXPECTED,
  DEFAULT_PORTS,
  HINT_EXPECTED,
  METHODS,
  SERVICE_NAME_PATTERN,
  type Service,
  serviceShapeV1,
  urlProblem,
} from "./schema";

const INTEGER = /^\d+$/;

function schemaProblem(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

export function parseExpectList(value: string): number | number[] {
  const codes = value.split(",").map((code) => Number(code.trim()));
  return codes.length === 1 ? (codes[0] as number) : codes;
}

export function nameProblem(name: string, taken: Iterable<string>): string | undefined {
  if (!SERVICE_NAME_PATTERN.test(name)) return "Letters, digits, _ and - only, e.g. api";
  if ([...taken].includes(name)) return `${name} already exists`;
  return undefined;
}

export function portProblem(port: string): string | undefined {
  if (!INTEGER.test(port)) return "A port number, e.g. 3000";
  return schemaProblem(serviceShapeV1.port, Number(port)) && "A port between 1 and 65535";
}

export function hostProblem(host: string): string | undefined {
  return /\s|\//.test(host) || host === "" ? "A host name or an IP, e.g. localhost" : undefined;
}

export function pathProblem(path: string): string | undefined {
  return schemaProblem(serviceShapeV1.path, path) && "A path that starts with /";
}

export function methodProblem(method: string): string | undefined {
  return schemaProblem(serviceShapeV1.method, method) && `One of ${METHODS.join(", ")}`;
}

export function hintProblem(hint: string): string | undefined {
  return schemaProblem(serviceShapeV1.hint, hint) && HINT_EXPECTED;
}

export function containsProblem(text: string): string | undefined {
  return schemaProblem(serviceShapeV1.contains, text) && CONTAINS_EXPECTED;
}

export function expectProblem(expect: string): string | undefined {
  const codes = expect.split(",").map((code) => code.trim());
  if (!codes.every((code) => INTEGER.test(code))) return "A status, or several: 200 or 200,204";
  return (
    schemaProblem(serviceShapeV1.expect, parseExpectList(expect)) && "Statuses go from 100 to 599"
  );
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `localhost:3000` is read as a scheme by `new URL`: the text decides, not the parser. */
export const withScheme = (address: string) => {
  const trimmed = address.trim();
  return trimmed === "" || SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`;
};

export type Address = Pick<Service, "url" | "host" | "port" | "path">;

// The text is split by hand, not by `new URL`: it would lowercase a host written by hand,
// and a host left as typed is a host an edit does not rewrite.
const PLAIN_HTTP = /^http:\/\/(\[[^\]]+\]|[^/:?#[\]]+):(\d+)(\/.*)?$/i;

// A bare port is a port on this machine: `http://3000` would be read as the IP 0.0.11.184.
const expanded = (text: string) =>
  withScheme(INTEGER.test(text.trim()) ? `localhost:${text.trim()}` : text);

/** What is wrong with an address; it is never repeated, it may hold a user and a password. */
const TYPED_PORT = /^[a-z]+:\/\/(?:\[[^\]]*\]|[^/:?#]*):(\d+)(?:[/?#]|$)/i;

export function addressProblem(text: string): string | undefined {
  if (text.trim() === "") return "An address, e.g. localhost:3000 or https://api.example.com";
  // Checked first: past 65535 the URL itself is refused, which says less.
  const port = TYPED_PORT.exec(expanded(text))?.[1];
  const portWrong = port === undefined ? undefined : portProblem(port);
  if (portWrong) return portWrong;
  const problem = urlProblem(expanded(text));
  return problem && `Expected ${problem}`;
}

/**
 * The keys an address is written with: plain http with its port keeps `host`, `port` and `path`,
 * the shape a form has always written; anything else (https, no port, a query) is a `url`.
 */
export function addressFields(text: string): Address {
  const url = expanded(text);
  const plain = PLAIN_HTTP.exec(url);
  if (!plain) {
    // What the config reads from a `url`; only `url` is written.
    const parsed = new URL(url);
    const port =
      Number(parsed.port) || DEFAULT_PORTS[parsed.protocol as keyof typeof DEFAULT_PORTS];
    return { url, host: parsed.hostname, port, path: parsed.pathname + parsed.search };
  }
  const [, host = "", port, path] = plain;
  return { host: host.replace(/^\[(.*)\]$/, "$1"), port: Number(port), path: path || "/" };
}

/** The text of an address, as `addressFields` reads it back. */
export function addressText({ url, host, port, path }: Address): string {
  if (url !== undefined) return url;
  const shown = host.includes(":") ? `[${host}]` : host;
  return `${shown}:${port}${path === "/" ? "" : path}`;
}
