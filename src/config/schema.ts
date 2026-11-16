import { z } from "zod";
import { MAX_TIMEOUT_SECONDS } from "../constants";
import { headerNameProblem, headerValueProblem } from "./headers";

export const CURRENT_SCHEMA_VERSION = 1;

export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

// A closed list: the method is written as is in the curl command that gets copied.
export const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];
export const DEFAULT_METHOD: Method = "GET";

const statusCode = z.number().int().min(100).max(599);

const DEFAULT_HOST = "localhost";
const DEFAULT_PATH = "/";
const DEFAULT_PORTS = { "http:": 80, "https:": 443 } as const;

function parsedUrl(value: string): URL | undefined {
  return URL.canParse(value) ? new URL(value) : undefined;
}

// The URL is never repeated: it may hold what must not be shown.
export function urlProblem(value: string): string | undefined {
  const url = parsedUrl(value);
  if (!url || !(url.protocol in DEFAULT_PORTS) || url.hostname === "") {
    return "an http:// or https:// URL, e.g. https://localhost:8443/health";
  }
  // config.yml is shared: nothing secret goes in it.
  if (url.username !== "" || url.password !== "") return "a URL without a user or a password";
  return undefined;
}

export interface Service {
  url?: string;
  host: string;
  port: number;
  path: string;
  expect?: number | number[];
  timeout?: number;
  method?: Method;
  headers?: Record<string, string>;
  hint?: string;
  tags?: string[];
  contains?: string;
}

// What is wrong is said without the value: it may be a secret pasted where a reference is expected.
const headersSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .transform((headers, ctx) => {
    const seen = new Map<string, string>();
    const texts: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      const twin = seen.get(name.toLowerCase());
      seen.set(name.toLowerCase(), name);
      const problem = twin
        ? `declared twice, also as ${twin}: header names ignore case`
        : (headerNameProblem(name) ?? headerValueProblem(name, String(value)));
      if (problem) {
        ctx.issues.push({
          code: "custom",
          message: twin ? problem : `expected ${problem}`,
          input: name,
          path: [name],
        });
      }
      texts[name] = String(value);
    }
    return texts;
  });

// One line of plain text: it is printed as is under the service, in any terminal.
const LINE_FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]/u;
export const HINT_EXPECTED = "one line of text, e.g. start it with: make api";
export const CONTAINS_EXPECTED = 'one line of text, e.g. "status":"ok"';

const oneLine = (expected: string) =>
  z.string().refine((text) => text.trim() !== "" && !LINE_FORBIDDEN.test(text), {
    error: `expected ${expected}`,
  });

export const NAME_EXPECTED = "letters, digits, _ and - only";

export const serviceObjectV1 = z.strictObject({
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
  timeout: z.number().positive().max(MAX_TIMEOUT_SECONDS).optional(),
  method: z
    .string()
    // `fetch` sends a lowercase method as typed, and servers refuse it.
    .transform((method) => method.toUpperCase())
    .pipe(z.enum(METHODS))
    .optional(),
  headers: headersSchema.optional(),
  hint: oneLine(HINT_EXPECTED).optional(),
  tags: z.array(z.string().regex(SERVICE_NAME_PATTERN, NAME_EXPECTED)).optional(),
  contains: oneLine(CONTAINS_EXPECTED).optional(),
});

export const serviceShapeV1 = serviceObjectV1.shape;

const ADDRESS_KEYS = ["host", "port", "path"] as const;

export const serviceSchemaV1 = serviceObjectV1.transform((service, ctx): Service => {
  const { url, host, port, path, ...rest } = service;
  if (service.method === "HEAD" && service.contains !== undefined) {
    ctx.issues.push({
      code: "custom",
      message: "cannot be set with `method: HEAD`, whose response has no body",
      input: service.contains,
      path: ["contains"],
    });
    return z.NEVER;
  }
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
    .record(z.string().regex(SERVICE_NAME_PATTERN, NAME_EXPECTED), serviceSchemaV1)
    // `services:` with nothing under it parses as null.
    .nullish()
    .transform((services) => services ?? {}),
});

export type Config = z.infer<typeof configSchemaV1>;

export type SchemaTable = Record<number, z.ZodType>;

export const schemas: SchemaTable = {
  1: configSchemaV1,
};
