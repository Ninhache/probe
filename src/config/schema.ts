import { z } from "zod";
import { MAX_TIMEOUT_SECONDS } from "../constants";

export const CURRENT_SCHEMA_VERSION = 1;

export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const statusCode = z.number().int().min(100).max(599);

const DEFAULT_HOST = "localhost";
const DEFAULT_PATH = "/";
const DEFAULT_PORTS = { "http:": 80, "https:": 443 } as const;

function parsedUrl(value: string): URL | undefined {
  return URL.canParse(value) ? new URL(value) : undefined;
}

/**
 * Why a URL cannot be the address of a service, in a few words that follow "expects"; undefined
 * when it can. The URL itself is never repeated: it may hold what must not be shown.
 */
export function urlProblem(value: string): string | undefined {
  const url = parsedUrl(value);
  if (!url || !(url.protocol in DEFAULT_PORTS) || url.hostname === "") {
    return "an http:// or https:// URL, e.g. https://localhost:8443/health";
  }
  // config.yml is shared: nothing secret goes in it.
  if (url.username !== "" || url.password !== "") return "a URL without a user or a password";
  return undefined;
}

/** A service as the checks see it; `url` is set when the config declares it by one. */
export interface Service {
  url?: string;
  host: string;
  port: number;
  path: string;
  expect?: number | number[];
  timeout?: number;
}

/** The keys a service may have in the file, before they are read as a whole. */
export const serviceObjectV1 = z.strictObject({
  /** The whole address, http or https, instead of `host`, `port` and `path`. */
  url: z
    .string()
    .refine((value) => urlProblem(value) === undefined, {
      error: (issue) => `expected ${urlProblem(String(issue.input))}`,
    })
    .optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  path: z.string().startsWith("/").optional(),
  expect: z.union([statusCode, z.array(statusCode).min(1)]).optional(),
  /** Seconds given to this service to answer, instead of the default. */
  timeout: z.number().positive().max(MAX_TIMEOUT_SECONDS).optional(),
});

/** What each key of a service accepts, to check one typed value at a time. */
export const serviceShapeV1 = serviceObjectV1.shape;

const ADDRESS_KEYS = ["host", "port", "path"] as const;

/**
 * A service is found by `port` (with `host` and `path`) or by `url`, never both. Read from the
 * file, it always has its host, port and path: those of the URL when it is declared by one.
 */
export const serviceSchemaV1 = serviceObjectV1.transform((service, ctx): Service => {
  const { url, host, port, path, ...rest } = service;
  if (url === undefined) {
    if (port === undefined) {
      ctx.issues.push({
        code: "custom",
        message: "Invalid input: expected number, received undefined",
        input: port,
        path: ["port"],
      });
      return z.NEVER;
    }
    return { host: host ?? DEFAULT_HOST, port, path: path ?? DEFAULT_PATH, ...rest };
  }
  const extra = ADDRESS_KEYS.filter((key) => service[key] !== undefined);
  for (const key of extra) {
    ctx.issues.push({
      code: "custom",
      message: "cannot be set together with `url`, which already says it",
      input: service[key],
      path: [key],
    });
  }
  const parsed = parsedUrl(url);
  if (extra.length > 0 || !parsed) return z.NEVER;
  return {
    url,
    host: parsed.hostname,
    port: Number(parsed.port) || DEFAULT_PORTS[parsed.protocol as keyof typeof DEFAULT_PORTS],
    path: parsed.pathname + parsed.search,
    ...rest,
  };
});

export const configSchemaV1 = z.strictObject({
  schemaVersion: z.literal(1),
  services: z
    .record(
      z.string().regex(SERVICE_NAME_PATTERN, "letters, digits, _ and - only"),
      serviceSchemaV1,
    )
    // `services:` with nothing under it parses as null.
    .nullish()
    .transform((services) => services ?? {}),
});

export type Config = z.infer<typeof configSchemaV1>;

export type SchemaTable = Record<number, z.ZodType>;

export const schemas: SchemaTable = {
  1: configSchemaV1,
};
