import { SERVICE_TYPES, type ServiceKey, type ServiceKind, serviceKeys } from "../config/schema";

// The key each flag writes: a type that does not read the key refuses the flag.
export const FLAG_KEYS = {
  url: "url",
  port: "port",
  host: "host",
  path: "path",
  expect: "expect",
  contains: "contains",
  method: "method",
  header: "headers",
  setenv: "env",
  user: "user",
  database: "database",
  password: "password",
} as const satisfies Readonly<Record<string, ServiceKey>>;
export type Flag = keyof typeof FLAG_KEYS;

/** The key behind every option of `probe add`: the completion offers an option where the type reads its key. */
export const ADD_OPTION_KEYS: Readonly<Record<string, ServiceKey>> = {
  ...FLAG_KEYS,
  type: "type",
  command: "command",
  timeout: "timeout",
  hint: "hint",
  tag: "tags",
};

/** The options of `probe add`, among `options`, that a service of each type accepts. */
export function addOptionsByType(options: readonly string[]): Record<ServiceKind, string[]> {
  return Object.fromEntries(
    SERVICE_TYPES.map((type) => {
      const keys = serviceKeys(type);
      const key = (option: string) => ADD_OPTION_KEYS[option.replace(/^--/, "")];
      return [
        type,
        options.filter(
          (option) => key(option) === undefined || keys.has(key(option) as ServiceKey),
        ),
      ];
    }),
  ) as Record<ServiceKind, string[]>;
}
