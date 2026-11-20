import { reference } from "../config/headers";
import {
  type DatabaseKind,
  databaseProblem,
  passwordProblem,
  type Service,
  userProblem,
} from "../config/schema";
import { portProblem } from "../config/service-input";
import { COMMAND_PING_QUERY } from "../constants";
import { copiedCommand, copiedNote, runCommand } from "./command";
import type { FieldValues, ServiceForm, ServiceType } from "./types";

const OPEN_REFERENCE = "$" + "{";

const DEFAULT_HOST = "localhost";

interface Connection {
  host: string;
  port: number;
  user: string | undefined;
  database: string | undefined;
}

/** What one kind of database is: its client, how it is given the password, and the question it is asked. */
interface DatabaseSpec {
  type: DatabaseKind;
  client: string;
  /** The variable the client reads its password from: arguments are visible to `ps`, the environment is not. */
  passwordEnv: string;
  defaultPort: number;
  defaultUser?: string;
  /** Up only when the client says this: redis-cli exits 0 on an error reply. */
  answer?: string;
  /** The URL-like text lists and reports show; it never holds the password. */
  scheme: string;
  /** The arguments of the client, after its name. */
  args(connection: Connection): string[];
}

const optional = <T>(value: T | undefined, words: (value: T) => string[]) =>
  value === undefined ? [] : words(value);

const SPECS: Readonly<Record<DatabaseKind, DatabaseSpec>> = {
  postgres: {
    type: "postgres",
    client: "psql",
    passwordEnv: "PGPASSWORD",
    defaultPort: 5432,
    defaultUser: "postgres",
    scheme: "postgres",
    // `-w` never asks for a password: a prompt would hold the check until its timeout.
    args: ({ host, port, user, database }) => [
      "-X",
      "-w",
      "-h",
      host,
      "-p",
      String(port),
      "-U",
      user as string,
      ...optional(database, (name) => ["-d", name]),
      "-c",
      COMMAND_PING_QUERY,
    ],
  },
  mysql: {
    type: "mysql",
    client: "mysql",
    passwordEnv: "MYSQL_PWD",
    defaultPort: 3306,
    defaultUser: "root",
    scheme: "mysql",
    // Over TCP: on localhost the client would take the socket and ignore the port.
    args: ({ host, port, user, database }) => [
      "--protocol=TCP",
      "-h",
      host,
      "-P",
      String(port),
      "-u",
      user as string,
      // One word: a name that starts with `-` stays the value of the option.
      ...optional(database, (name) => [`--database=${name}`]),
      "-e",
      COMMAND_PING_QUERY,
    ],
  },
  redis: {
    type: "redis",
    client: "redis-cli",
    passwordEnv: "REDISCLI_AUTH",
    defaultPort: 6379,
    answer: "PONG",
    scheme: "redis",
    args: ({ host, port, user, database }) => [
      "-h",
      host,
      "-p",
      String(port),
      ...optional(user, (name) => ["--user", name]),
      ...optional(database, (index) => ["-n", index]),
      "ping",
    ],
  },
};

function connection(spec: DatabaseSpec, service: Service): Connection {
  return {
    host: service.host ?? DEFAULT_HOST,
    port: service.port ?? spec.defaultPort,
    user: service.user ?? spec.defaultUser,
    database: service.database === undefined ? undefined : String(service.database),
  };
}

/** The command a database service runs: its client with the arguments, and the password as a `${NAME}` reference. */
export function databaseCommand(
  type: DatabaseKind,
  service: Service,
): { command: string[]; env?: Record<string, string> } {
  const spec = SPECS[type];
  return {
    command: [spec.client, ...spec.args(connection(spec, service))],
    ...(service.password === undefined ? {} : { env: { [spec.passwordEnv]: service.password } }),
  };
}

function targetOf(spec: DatabaseSpec, service: Service): string {
  const { host, port, user, database } = connection(spec, service);
  const login = service.user === undefined ? "" : `${user}@`;
  return `${spec.scheme}://${login}${host}:${port}${database === undefined ? "" : `/${database}`}`;
}

const FIELDS = [
  { key: "host", label: "Host", placeholder: DEFAULT_HOST },
  { key: "port", label: "Port", placeholder: "" },
  { key: "user", label: "User", placeholder: "" },
  { key: "database", label: "Database", placeholder: "" },
  { key: "password", label: "Password", placeholder: `\${PG_PASSWORD}` },
] as const;

const filled = (value: string) => (value.trim() === "" ? undefined : value.trim());

function databaseForm(spec: DatabaseSpec): ServiceForm {
  const placeholders: Record<string, string> = {
    port: String(spec.defaultPort),
    user: spec.defaultUser ?? "",
    database: spec.type === "redis" ? "0" : "",
    password: reference(`${spec.type.toUpperCase()}_PASSWORD`),
  };
  const problems: Record<string, (value: string) => string | undefined> = {
    // A plain value is kept in local.yml by the dashboard; one that holds `${` must be a reference alone.
    password: (value) =>
      value.includes(OPEN_REFERENCE) && passwordProblem(value)
        ? `Expects a reference alone, e.g. ${reference("PG_PASSWORD")}: a password that holds ${OPEN_REFERENCE} goes through probe var`
        : undefined,
    port: portProblem,
    user: userProblem,
    database: (value) => databaseProblem(spec.type, value),
  };
  return {
    fields: FIELDS.map((field) => ({
      ...field,
      placeholder: placeholders[field.key] ?? field.placeholder,
    })),
    // A value typed there that is not a reference is kept in local.yml by the dashboard.
    secretField: "password",
    read: ({ host, port, user, database, password }) => ({
      host: host ?? "",
      port: port === undefined ? "" : String(port),
      user: user ?? "",
      database: database === undefined ? "" : String(database),
      password: password ?? "",
    }),
    problem: (key, value) =>
      filled(value) === undefined ? undefined : problems[key]?.(value.trim()),
    written: (values: FieldValues) => {
      const database = filled(values.database ?? "");
      return {
        type: spec.type,
        host: filled(values.host ?? ""),
        port: filled(values.port ?? "") === undefined ? undefined : Number(values.port),
        user: filled(values.user ?? ""),
        database: database !== undefined && spec.type === "redis" ? Number(database) : database,
        password: filled(values.password ?? ""),
      };
    },
  };
}

/** The type of a database service: the client it runs, built from the keys of the service, spawned without a shell. */
export function databaseType(type: DatabaseKind): ServiceType {
  const spec = SPECS[type];
  const asCommand = (service: Service): Service => ({
    type: "command",
    ...databaseCommand(type, service),
  });
  return {
    type,
    target: (service) => targetOf(spec, service),
    // The reference stays one, for the shell that runs it: the password is never in the copy.
    copy: (service, env) => ({
      command: copiedCommand(asCommand(service)),
      note: copiedNote(asCommand(service), env),
    }),
    form: databaseForm(spec),
    check: (name, service, context) =>
      runCommand(
        {
          base: { name, type, target: targetOf(spec, service) },
          ...databaseCommand(type, service),
          envPlace: "a password",
          stdoutIncludes: spec.answer,
          notFound: {
            error: `${spec.client} is not installed`,
            hint: `probe runs ${spec.client} from the PATH: install it, or check that it is there`,
          },
        },
        context,
      ),
  };
}
