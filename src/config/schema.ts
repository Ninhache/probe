import { z } from "zod";
import { MAX_TIMEOUT_SECONDS } from "../constants";
import {
  envNameProblem,
  envValueProblem,
  headerNameProblem,
  headerValueProblem,
  isSensitiveHeader,
} from "./headers";

export const CURRENT_SCHEMA_VERSION = 1;

export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

// A closed list: the method is written as is in the curl command that gets copied.
export const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];
export const DEFAULT_METHOD: Method = "GET";

const statusCode = z.number().int().min(100).max(599);

const DEFAULT_HOST = "localhost";
const DEFAULT_PATH = "/";
export const DEFAULT_PORTS = { "http:": 80, "https:": 443 } as const;

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

/** The types that connect to a database with its own client; each is a `command` underneath. */
export const DATABASE_TYPES = ["postgres", "mysql", "redis"] as const;
export type DatabaseKind = (typeof DATABASE_TYPES)[number];

export const SERVICE_TYPES = ["http", "command", ...DATABASE_TYPES] as const;
export type ServiceKind = (typeof SERVICE_TYPES)[number];

export const isDatabaseKind = (type: string | undefined): type is DatabaseKind =>
  (DATABASE_TYPES as readonly (string | undefined)[]).includes(type);

// The client takes these as the value of a flag: no leading `-`, no `=` (psql reads a `dbname`
// holding one as a connection string), no space.
const USER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.@$-]*$/;
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.$-]*$/;
const DATABASE_INDEX_PATTERN = /^\d+$/;
const PASSWORD_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

export const USER_EXPECTED = "a user name of letters, digits and _ . @ $ -, e.g. postgres";
export const DATABASE_NAME_EXPECTED = "a database name of letters, digits and _ . $ -, e.g. app";
export const DATABASE_INDEX_EXPECTED = "a database number, e.g. 0";
// Never the value itself: it may be the password, and config.yml is shared.
export const PASSWORD_EXPECTED = `a reference to a variable, e.g. \${PG_PASSWORD}: config.yml is shared, so the value goes in local.yml (probe var PG_PASSWORD)`;

export const userProblem = (user: string): string | undefined =>
  USER_PATTERN.test(user) ? undefined : USER_EXPECTED;

export function databaseProblem(type: DatabaseKind, database: string | number): string | undefined {
  const text = String(database);
  if (type === "redis")
    return DATABASE_INDEX_PATTERN.test(text) ? undefined : DATABASE_INDEX_EXPECTED;
  return DATABASE_NAME_PATTERN.test(text) ? undefined : DATABASE_NAME_EXPECTED;
}

export const passwordProblem = (password: string): string | undefined =>
  PASSWORD_REFERENCE.test(password) ? undefined : PASSWORD_EXPECTED;

export interface Service {
  /** Absent for an http service: the key is optional, and a writer never adds it. */
  type?: ServiceKind;
  /** A list is spawned as is; a string goes through the system shell. */
  command?: string | string[];
  url?: string;
  urls?: Record<string, string>;
  host?: string;
  port?: number;
  path?: string;
  expect?: number | number[];
  timeout?: number;
  method?: Method;
  headers?: Record<string, string>;
  /** Only for a command: the variables its process is given. */
  env?: Record<string, string>;
  /** Only for a database service. */
  user?: string;
  /** A name, or for redis the number of the database; only for a database service. */
  database?: string | number;
  /** Only for a database service: a `${NAME}` reference, never the password. */
  password?: string;
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

// Said without the value, like the headers: it may be a secret pasted where a reference is expected.
const envSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .transform((env, ctx) => {
    const texts: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
      const problem = envNameProblem(name) ?? envValueProblem(name, String(value));
      if (problem) {
        ctx.issues.push({
          code: "custom",
          message: `expected ${problem}`,
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
// Any text on one line: query and path encode it. A comma would split it in the dashboard form.
export const PARAMETER_VALUE_PATTERN = /^(?![\s,])[^,\p{Cc}\p{Zl}\p{Zp}]*(?<![\s,])$/u;
export const VALUE_EXPECTED = "text on one line, without commas or spaces around it";
const QUERY_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
// `fetch` sends Latin-1 and curl the bytes of the shell: only ASCII reaches a server the same way.
// No `${`: the value would be read as a variable, and a secret sent in a header shown in clear.
const HEADER_VALUE_PATTERN = /^(?!.*\$\{)[\x20-\x7e]+$/;

const parameterWord = z.string().regex(PARAMETER_VALUE_PATTERN, VALUE_EXPECTED);

const urlText = z.string().refine((value) => urlProblem(value) === undefined, {
  error: (issue) => `expected ${urlProblem(String(issue.input))}`,
});

export const COMMAND_EXPECTED =
  'a command: a string run by the shell, e.g. "redis-cli ping", or a list of arguments run as is, e.g. [docker, compose, exec, -T, db, pg_isready]';

const commandWord = z.string().regex(/\S/, "expected a word that is not empty");

const commandSchema = z.union([commandWord, z.array(commandWord).min(1)], {
  error: `expected ${COMMAND_EXPECTED}`,
});

export const serviceObjectV1 = z.strictObject({
  type: z.enum(SERVICE_TYPES).optional(),
  command: commandSchema.optional(),
  url: urlText.optional(),
  urls: z.record(parameterWord, urlText).optional(),
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
  env: envSchema.optional(),
  user: z.string().min(1).optional(),
  database: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
  password: z.string().optional(),
  hint: oneLine(HINT_EXPECTED).optional(),
  tags: z.array(z.string().regex(SERVICE_NAME_PATTERN, NAME_EXPECTED)).optional(),
  contains: oneLine(CONTAINS_EXPECTED).optional(),
});

export const serviceShapeV1 = serviceObjectV1.shape;

const ADDRESS_KEYS = ["host", "port", "path"] as const;

// Services that take their address only from `urls:`: their host, port and path are read from it,
// and the config checks that every value of the parameter has one.
const addressless = new WeakSet<Service>();

/** Whether the file gives the service an address of its own, `url` or `port`, beyond `urls:`. */
export const declaresAddress = (service: Service) => !addressless.has(service);

const firstAddress = (urls: Record<string, string> | undefined) =>
  Object.values(urls ?? {})
    .map(parsedUrl)
    .find((parsed) => parsed !== undefined);

// What a request is made of: a service that runs a command has none of it.
const HTTP_ONLY_KEYS = [
  "url",
  "urls",
  "host",
  "port",
  "path",
  "method",
  "headers",
  "expect",
  "contains",
] as const;

const DATABASE_KEYS = ["user", "database", "password"] as const;

const DATABASE_ONLY_MESSAGE =
  "needs `type: postgres`, `type: mysql` or `type: redis`: only a database service has a user, a database and a password";

// Said without the value: a password typed there must not come back on screen.
function databaseService(service: z.infer<typeof serviceObjectV1>, ctx: z.core.$RefinementCtx) {
  const type = service.type as DatabaseKind;
  const refused = [...HTTP_ONLY_KEYS, "command", "env"].filter(
    (key) => key !== "host" && key !== "port" && service[key as keyof typeof service] !== undefined,
  );
  const fail = (key: string, message: string) =>
    ctx.issues.push({ code: "custom", message, input: undefined, path: [key] });
  for (const key of refused) {
    fail(
      key,
      `cannot be set with \`type: ${type}\`: it connects to a database, it sends no request`,
    );
  }
  const user = service.user === undefined ? undefined : userProblem(service.user);
  if (user) fail("user", `expected ${user}`);
  const database =
    service.database === undefined ? undefined : databaseProblem(type, service.database);
  if (database) fail("database", `expected ${database}`);
  const password = service.password === undefined ? undefined : passwordProblem(service.password);
  if (password) fail("password", `expected ${password}`);
  if (refused.length > 0 || user || database || password) return z.NEVER;
  return service as Service;
}

export const serviceSchemaV1 = serviceObjectV1.transform((service, ctx): Service => {
  if (isDatabaseKind(service.type)) return databaseService(service, ctx);
  const misplaced = DATABASE_KEYS.filter((key) => service[key] !== undefined);
  for (const key of misplaced) {
    ctx.issues.push({
      code: "custom",
      message:
        service.type === "command"
          ? "cannot be set with `type: command`: only a database service has a user, a database and a password"
          : DATABASE_ONLY_MESSAGE,
      input: undefined,
      path: [key],
    });
  }
  if (misplaced.length > 0) return z.NEVER;
  if (service.type === "command") {
    const { command, ...others } = service;
    const extra = HTTP_ONLY_KEYS.filter((key) => service[key] !== undefined);
    for (const key of extra) {
      ctx.issues.push({
        code: "custom",
        message: "cannot be set with `type: command`: it runs a command, it sends no request",
        input: service[key],
        path: [key],
      });
    }
    if (command === undefined) {
      ctx.issues.push({
        code: "custom",
        message: `\`type: command\` needs a \`command\`: expected ${COMMAND_EXPECTED}`,
        input: command,
        path: ["command"],
      });
    }
    if (extra.length > 0 || command === undefined) return z.NEVER;
    return { ...others, command } as Service;
  }
  const needsCommand = (["command", "env"] as const).filter((key) => service[key] !== undefined);
  for (const key of needsCommand) {
    ctx.issues.push({
      code: "custom",
      message:
        key === "env"
          ? "needs `type: command`: only a command has an environment, a request has headers"
          : "needs `type: command`: an http service sends a request",
      input: service[key],
      path: [key],
    });
  }
  if (needsCommand.length > 0) return z.NEVER;
  const { url, host, port, path, command: _, env: __, ...rest } = service;
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
    const fromUrls = port === undefined && host === undefined && path === undefined;
    const first = fromUrls ? firstAddress(service.urls) : undefined;
    if (first) {
      const resolved: Service = {
        host: first.hostname,
        port: Number(first.port) || DEFAULT_PORTS[first.protocol as keyof typeof DEFAULT_PORTS],
        path: first.pathname + first.search,
        ...rest,
      };
      addressless.add(resolved);
      return resolved;
    }
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

function strategyHeaderProblem(name: string): string | undefined {
  const problem = headerNameProblem(name);
  if (problem) return problem;
  // The values are written in config.yml, which is shared: nothing secret goes in it.
  return isSensitiveHeader(name) ? "a header that carries no secret" : undefined;
}

const strategySchemaV1 = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("header"),
    name: z.string().refine((name) => strategyHeaderProblem(name) === undefined, {
      error: (issue) => `expected ${strategyHeaderProblem(String(issue.input))}`,
    }),
  }),
  z.strictObject({
    kind: z.literal("query"),
    name: z.string().regex(QUERY_NAME_PATTERN, "letters, digits, ., _ and - only"),
  }),
  z.strictObject({ kind: z.literal("path") }),
  z.strictObject({ kind: z.literal("url") }),
]);

const parameterSchemaV1 = z
  .strictObject({
    values: z
      // `values: [1, 2]` is read as numbers.
      .array(z.union([z.string(), z.number()]).transform(String).pipe(parameterWord))
      .min(1)
      .refine((values) => new Set(values).size === values.length, {
        error: "expected each value once",
      }),
    strategy: strategySchemaV1,
  })
  .superRefine(({ values, strategy }, ctx) => {
    if (strategy.kind !== "header") return;
    for (const [index, value] of values.entries()) {
      if (HEADER_VALUE_PATTERN.test(value)) continue;
      ctx.issues.push({
        code: "custom",
        message: `${value}: a header takes ASCII only, no accent and no \${`,
        input: value,
        path: ["values", index],
      });
    }
  });

export type Parameter = z.infer<typeof parameterSchemaV1>;

const URL_STRATEGY = "strategy: { kind: url }";

export const configSchemaV1 = z
  .strictObject({
    schemaVersion: z.literal(1),
    parameters: z
      .record(z.string().regex(SERVICE_NAME_PATTERN, NAME_EXPECTED), parameterSchemaV1)
      .superRefine((parameters, ctx) => {
        const taken = new Map<string, string>();
        for (const [name, { strategy }] of Object.entries(parameters)) {
          if (strategy.kind === "path") continue;
          // Header names ignore case, query names do not.
          const place =
            strategy.kind === "url"
              ? "url"
              : strategy.kind === "header"
                ? `header ${strategy.name.toLowerCase()}`
                : `query ${strategy.name}`;
          const twin = taken.get(place);
          taken.set(place, name);
          if (twin === undefined) continue;
          ctx.issues.push({
            code: "custom",
            message: `sets the same ${strategy.kind} as ${twin}`,
            input: strategy.kind,
            path: [name, "strategy", strategy.kind === "url" ? "kind" : "name"],
          });
        }
      })
      .nullish(),
    services: z
      .record(z.string().regex(SERVICE_NAME_PATTERN, NAME_EXPECTED), serviceSchemaV1)
      // `services:` with nothing under it parses as null.
      .nullish()
      .transform((services) => services ?? {}),
  })
  .superRefine((config, ctx) => {
    const values = Object.values(config.parameters ?? {}).find(
      ({ strategy }) => strategy.kind === "url",
    )?.values;
    for (const [name, service] of Object.entries(config.services)) {
      const { urls } = service;
      if (!declaresAddress(service)) {
        for (const value of values ?? []) {
          if (urls?.[value] !== undefined) continue;
          ctx.issues.push({
            code: "custom",
            message: `${value} has no address, and ${name} has no port or url of its own`,
            input: undefined,
            path: ["services", name, "urls", value],
          });
        }
      }
      for (const value of Object.keys(urls ?? {})) {
        if (values?.includes(value)) continue;
        ctx.issues.push({
          code: "custom",
          message: values
            ? `expected a value of the parameter: ${values.join(", ")}`
            : `needs a parameter with \`${URL_STRATEGY}\``,
          input: value,
          path: ["services", name, "urls", value],
        });
      }
    }
  });

export type Config = z.infer<typeof configSchemaV1>;

export type SchemaTable = Record<number, z.ZodType>;

export const schemas: SchemaTable = {
  1: configSchemaV1,
};
