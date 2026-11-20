import { chmod, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { databaseCommand } from "../src/checkers/database";
import { serviceType } from "../src/checkers/registry";
import { reference, serviceVariables } from "../src/config/headers";
import { configSchemaV1, type Service } from "../src/config/schema";
import { tempDir } from "./helpers";

const SECRET = "Zq9-mk4p-sample";
const REFERENCE = reference("DB_PASSWORD");

const parse = (service: unknown) =>
  configSchemaV1.safeParse({ schemaVersion: 1, services: { db: service } });
const issues = (service: unknown) =>
  parse(service).error?.issues.map(({ path, message }) => ({
    path: path.slice(2).join("."),
    message,
  }));
const parsed = (service: unknown): Service => {
  const result = parse(service);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data.services.db as Service;
};

const variables = (values: Record<string, string>) => ({ lookup: (name: string) => values[name] });

describe("the config of a database service", () => {
  it.each(["postgres", "mysql", "redis"])("accepts %s with every key", (type) => {
    const service = {
      type,
      host: "db.local",
      port: 15432,
      user: "app",
      database: type === "redis" ? 2 : "wakfuli",
      password: REFERENCE,
    };

    expect(parse(service).data?.services.db).toEqual(service);
  });

  it("needs no key but the type", () => {
    expect(parse({ type: "postgres" }).success).toBe(true);
  });

  it.each([
    ["a string", SECRET],
    ["a number", 123456],
    ["a reference inside a text", `pw-${REFERENCE}`],
    ["two references", `${reference("A")}${reference("B")}`],
  ])("refuses a password that is %s, without repeating it", (_, password) => {
    const found = issues({ type: "postgres", password });

    expect(found).toHaveLength(1);
    expect(found?.[0]?.path).toBe("password");
    expect(JSON.stringify(found)).not.toContain(String(password));
    if (typeof password === "string") expect(found?.[0]?.message).toContain("probe var");
  });

  it.each(["user", "database", "password"])("refuses %s on an http service", (key) => {
    expect(issues({ port: 3000, [key]: "x" })).toEqual([
      {
        path: key,
        message:
          "needs `type: postgres`, `type: mysql` or `type: redis`: only a database service has a user, a database and a password",
      },
    ]);
  });

  it("refuses the keys of a database on a command", () => {
    expect(issues({ type: "command", command: "x", user: "root" })).toEqual([
      {
        path: "user",
        message:
          "cannot be set with `type: command`: only a database service has a user, a database and a password",
      },
    ]);
  });

  it("refuses the keys of a request or of a command on a database", () => {
    expect(
      issues({ type: "mysql", url: "http://localhost", path: "/x", command: "x", env: { A: "b" } })
        ?.map(({ path }) => path)
        .sort(),
    ).toEqual(["command", "env", "path", "url"]);
  });

  it.each([
    ["postgres", "database", "-x", "a database name"],
    ["postgres", "database", "host=evil", "a database name"],
    ["mysql", "database", "a b", "a database name"],
    ["redis", "database", "main", "a database number"],
    ["redis", "database", -1, "Too small"],
    ["postgres", "user", "-x", "a user name"],
  ])("refuses %s %s %j", (type, key, value, said) => {
    const found = issues({ type, [key]: value });

    expect(found).toHaveLength(1);
    expect(found?.[0]?.message).toContain(said);
    expect(found?.[0]?.message).not.toContain(String(value));
  });

  it("accepts a redis database written as a number or as digits", () => {
    expect(parse({ type: "redis", database: 0 }).success).toBe(true);
    expect(parse({ type: "redis", database: "3" }).success).toBe(true);
  });

  it("lists the variable of the password among the variables of the service", () => {
    expect(serviceVariables(parsed({ type: "mysql", password: REFERENCE }))).toEqual([
      "DB_PASSWORD",
    ]);
  });
});

describe("the command a database service runs", () => {
  const svc = (service: Record<string, unknown>) => parsed(service);

  it("builds the psql arguments, with the password in the environment only", () => {
    const service = svc({ type: "postgres", port: 5433, database: "wakfuli", password: REFERENCE });

    expect(databaseCommand("postgres", service)).toEqual({
      command: [
        "psql",
        "-X",
        "-w",
        "-h",
        "localhost",
        "-p",
        "5433",
        "-U",
        "postgres",
        "-d",
        "wakfuli",
        "-c",
        "select 1",
      ],
      env: { PGPASSWORD: REFERENCE },
    });
  });

  it("builds the mysql arguments over TCP, the database as one word of its own", () => {
    const service = svc({
      type: "mysql",
      user: "app",
      database: "weird-name",
      password: REFERENCE,
    });

    expect(databaseCommand("mysql", service).command).toEqual(
      [
        "mysql",
        "--protocol=TCP",
        "-h",
        "localhost",
        "-P",
        "3306",
        "-u",
        "app",
        "--database=weird-name",
        "-e",
        "select 1",
      ].map((word) => word),
    );
    expect(databaseCommand("mysql", service).env).toEqual({ MYSQL_PWD: REFERENCE });
  });

  it("builds the redis-cli arguments: no user by default, a number for the database", () => {
    expect(databaseCommand("redis", svc({ type: "redis" }))).toEqual({
      command: ["redis-cli", "-h", "localhost", "-p", "6379", "ping"],
    });
    expect(
      databaseCommand("redis", svc({ type: "redis", user: "u", database: 2, password: REFERENCE })),
    ).toEqual({
      command: ["redis-cli", "-h", "localhost", "-p", "6379", "--user", "u", "-n", "2", "ping"],
      env: { REDISCLI_AUTH: REFERENCE },
    });
  });

  it("shows the address without the password, and copies the reference", () => {
    const service = svc({
      type: "postgres",
      user: "app",
      database: "wakfuli",
      password: REFERENCE,
    });
    const type = serviceType(service);

    expect(type.target(service)).toBe("postgres://app@localhost:5432/wakfuli");
    const copied = type.copy?.(service, {});
    expect(copied?.command).toBe(
      `env PGPASSWORD="${REFERENCE}" psql -X -w -h localhost -p 5432 -U app -d wakfuli -c 'select 1'`,
    );
    expect(copied?.note).toContain("DB_PASSWORD");
  });
});

// A `.cmd` cannot be spawned without a shell: the fake clients are scripts with a shebang.
describe.skipIf(process.platform === "win32")("checking a database through its client", () => {
  const FAKE = `#!${process.execPath}
const { writeFileSync } = require("node:fs");
const mode = process.env.FAKE_MODE ?? "ok";
const password = process.env.PGPASSWORD ?? process.env.MYSQL_PWD ?? process.env.REDISCLI_AUTH ?? "";
writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), hasPassword: password !== "" , password }));
if (mode === "refused") { process.stderr.write("FATAL: password " + password + " rejected\\n"); process.exit(2); }
if (mode === "noauth") { process.stdout.write("NOAUTH Authentication required.\\n"); process.exit(0); }
if (mode === "pong-with-error") { process.stdout.write("PONG\\n"); process.stderr.write("SELECT 99 failed: ERR DB index is out of range\\n"); process.exit(0); }
if (mode === "pong") process.stdout.write("PONG\\n");
`;

  async function clients() {
    const dir = await tempDir();
    for (const name of ["psql", "mysql", "redis-cli"]) {
      await writeFile(join(dir, name), FAKE);
      await chmod(join(dir, name), 0o755);
    }
    const log = join(dir, "called.json");
    vi.stubEnv("PATH", `${dir}${delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("FAKE_LOG", log);
    return {
      dir,
      called: async () =>
        JSON.parse(await readFile(log, "utf8")) as { argv: string[]; password: string },
    };
  }

  const check = (
    service: Record<string, unknown>,
    values: Record<string, string> = { DB_PASSWORD: SECRET },
  ) => {
    const parsedService = parsed(service);
    return serviceType(parsedService).check("db", parsedService, {
      timeoutMs: 10_000,
      variables: variables(values),
    });
  };

  it.each([
    ["postgres", "PGPASSWORD"],
    ["mysql", "MYSQL_PWD"],
    ["redis", "REDISCLI_AUTH"],
  ])("runs the client of %s with the password given by the environment", async (type, _) => {
    const { called } = await clients();
    vi.stubEnv("FAKE_MODE", "pong");

    const result = await check({ type, password: REFERENCE });

    expect(result).toMatchObject({ ok: true, type, exitCode: 0 });
    const { argv, password } = await called();
    expect(password).toBe(SECRET);
    expect(argv.join(" ")).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("never shows the password when the client echoes it, in the error or in the JSON", async () => {
    await clients();
    vi.stubEnv("FAKE_MODE", "refused");

    const result = await check({ type: "postgres", password: REFERENCE });

    expect(result).toMatchObject({
      ok: false,
      exitCode: 2,
      error: `FATAL: password ${REFERENCE} rejected`,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("says which variable is not set, and runs nothing", async () => {
    const { dir } = await clients();

    const result = await check({ type: "mysql", password: REFERENCE }, {});

    expect(result).toMatchObject({
      ok: false,
      error: "DB_PASSWORD is not set",
      hint: "set it for this machine: probe var DB_PASSWORD (or export it)",
    });
    await expect(readFile(join(dir, "called.json"))).rejects.toThrow();
  });

  it("treats a redis that answers an error with exit 0 as down", async () => {
    await clients();
    vi.stubEnv("FAKE_MODE", "noauth");

    expect(await check({ type: "redis" })).toMatchObject({
      ok: false,
      exitCode: 0,
      error: "NOAUTH Authentication required.",
    });
  });

  it("treats a redis that says PONG and complains as down", async () => {
    await clients();
    vi.stubEnv("FAKE_MODE", "pong-with-error");

    expect(await check({ type: "redis", database: 99 })).toMatchObject({
      ok: false,
      error: "SELECT 99 failed: ERR DB index is out of range",
    });
  });

  it("only needs exit 0 from psql and mysql", async () => {
    await clients();

    expect(await check({ type: "postgres" })).toMatchObject({ ok: true });
    expect(await check({ type: "mysql" })).toMatchObject({ ok: true });
  });

  it.each([
    ["postgres", "psql"],
    ["mysql", "mysql"],
    ["redis", "redis-cli"],
  ])("says when the client of %s is not installed", async (type, client) => {
    vi.stubEnv("PATH", await tempDir());

    expect(await check({ type })).toMatchObject({
      ok: false,
      error: `${client} is not installed`,
    });
  });
});
