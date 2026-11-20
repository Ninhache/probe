import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandChecker } from "../src/checkers/command";
import { isSensitiveEnv, serviceVariables } from "../src/config/headers";
import { configSchemaV1, type Service } from "../src/config/schema";
import { COMMAND_STDERR_CHARACTERS } from "../src/constants";
import { tempDir } from "./helpers";

const NODE = process.execPath;
// No test shares a name with what a runner may inherit: Windows reads names without their case.
const SECRET_NAME = "PROBE_ENVTEST_PASSWORD";
const SECRET = "Zq9-mk4p-sample";

const parse = (service: unknown) =>
  configSchemaV1.safeParse({ schemaVersion: 1, services: { db: service } });
const issues = (service: unknown) =>
  parse(service).error?.issues.map(({ path, message }) => ({
    path: path.slice(2).join("."),
    message,
  }));

const command = (script: string, env: Record<string, string>): Service => ({
  type: "command",
  command: [NODE, "-e", script],
  env,
});

const variables = (values: Record<string, string>, environment?: string) => ({
  lookup: (name: string) => values[name],
  ...(environment === undefined ? {} : { environment }),
});

describe("env in the config", () => {
  it("is accepted on a command, numbers and booleans read as text", () => {
    const env = { MYSQL_HOST: "127.0.0.1", MYSQL_PWD: "${DB_PASSWORD}", PORT: 3306, FLAG: true };

    expect(parse({ type: "command", command: "mysqladmin ping", env }).data?.services.db).toEqual({
      type: "command",
      command: "mysqladmin ping",
      env: { MYSQL_HOST: "127.0.0.1", MYSQL_PWD: "${DB_PASSWORD}", PORT: "3306", FLAG: "true" },
    });
  });

  it("is refused on an http service", () => {
    expect(issues({ port: 3000, env: { A: "b" } })).toEqual([
      {
        path: "env",
        message: "needs `type: command`: only a command has an environment, a request has headers",
      },
    ]);
  });

  it.each(["MYSQL_PWD", "PGPASSWORD", "API_TOKEN", "GH_SECRET", "AWS_KEY", "DB_PASS"])(
    "refuses a value of %s that is not a reference, without repeating it",
    (name) => {
      const found = issues({ type: "command", command: "x", env: { [name]: SECRET } });

      expect(found).toHaveLength(1);
      expect(found?.[0]?.message).toContain("a reference instead of the secret");
      expect(JSON.stringify(found)).not.toContain(SECRET);
    },
  );

  it("takes a plain value under a name that is no secret", () => {
    expect(isSensitiveEnv("MYSQL_HOST")).toBe(false);
    expect(issues({ type: "command", command: "x", env: { MYSQL_HOST: "db" } })).toBeUndefined();
  });

  it.each(["1BAD", "has-dash", "with space"])("refuses the name %s", (name) => {
    expect(issues({ type: "command", command: "x", env: { [name]: "v" } })?.[0]?.message).toContain(
      "expected a name of letters, digits and _",
    );
  });

  it("refuses a malformed reference", () => {
    expect(
      issues({ type: "command", command: "x", env: { A: "${not valid}" } })?.[0]?.message,
    ).toBe("expected a variable name between braces, e.g. ${DB_PASSWORD}");
  });

  it("counts toward the variables a service needs", () => {
    expect(
      serviceVariables({ headers: { "X-A": "${ONE}" }, env: { A: "${TWO}", B: "${ONE}-x" } }),
    ).toEqual(["ONE", "TWO"]);
  });
});

describe("env of a command", () => {
  const expected = `process.exit(process.env.${SECRET_NAME} === process.env.PROBE_ENVTEST_EXPECTED ? 0 : 1)`;

  it("gives the resolved value to the child", async () => {
    const service = command(expected, {
      [SECRET_NAME]: "${PROBE_ENVTEST_SECRET}",
      PROBE_ENVTEST_EXPECTED: SECRET,
    });

    const result = await commandChecker.check("db", service, {
      timeoutMs: 10_000,
      variables: variables({ PROBE_ENVTEST_SECRET: SECRET }),
    });

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
  });

  it("keeps the value out of the arguments", async () => {
    const script = `const seen = process.argv.concat(process.execArgv).join(" ");
process.exit(process.env.${SECRET_NAME} && !seen.includes(process.env.${SECRET_NAME}) ? 0 : 1)`;

    const result = await commandChecker.check(
      "db",
      command(script, { [SECRET_NAME]: "${PROBE_ENVTEST_SECRET}" }),
      { timeoutMs: 10_000, variables: variables({ PROBE_ENVTEST_SECRET: SECRET }) },
    );

    expect(result.ok).toBe(true);
  });

  it("does not run when a variable is not set, and says how to set it", async () => {
    const dir = await tempDir();
    const marker = join(dir, "ran");
    const script = `require("node:fs").writeFileSync(process.argv[1], "x")`;
    const service: Service = {
      type: "command",
      command: [NODE, "-e", script, marker],
      env: { [SECRET_NAME]: "${PROBE_ENVTEST_SECRET}" },
    };

    const result = await commandChecker.check("db", service, {
      timeoutMs: 10_000,
      variables: variables({}, "staging"),
    });

    expect(existsSync(marker)).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: "PROBE_ENVTEST_SECRET is not set",
      hint: "set it for this machine: probe var PROBE_ENVTEST_SECRET --env staging (or export it)",
    });
  });

  it("shows the reference where the child echoes the value", async () => {
    const script = `console.error("login failed for " + process.env.${SECRET_NAME}); process.exit(1)`;

    const result = await commandChecker.check(
      "db",
      command(script, { [SECRET_NAME]: "${PROBE_ENVTEST_SECRET}" }),
      { timeoutMs: 10_000, variables: variables({ PROBE_ENVTEST_SECRET: SECRET }) },
    );

    expect(result.error).toBe("login failed for ${PROBE_ENVTEST_SECRET}");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("masks a value that the cut of the line would split", async () => {
    const filler = "x".repeat(COMMAND_STDERR_CHARACTERS - 3);
    const script = `console.error(${JSON.stringify(filler)} + process.env.${SECRET_NAME}); process.exit(1)`;

    const result = await commandChecker.check(
      "db",
      command(script, { [SECRET_NAME]: "${PROBE_ENVTEST_SECRET}" }),
      { timeoutMs: 10_000, variables: variables({ PROBE_ENVTEST_SECRET: SECRET }) },
    );

    expect(result.error).not.toMatch(/Zq9|mk4p/);
  });

  it("copies the command with references, never the values", () => {
    const service: Service = {
      type: "command",
      command: ["mysqladmin", "ping"],
      env: { MYSQL_HOST: "127.0.0.1", MYSQL_PWD: "${DB_PASSWORD}" },
    };

    const copied = commandChecker.copy?.(service, {});

    expect(copied?.command).toBe(
      'env MYSQL_HOST=127.0.0.1 MYSQL_PWD="${DB_PASSWORD}" mysqladmin ping',
    );
    expect(copied?.note).toBe(
      "it runs from the project root; it reads DB_PASSWORD from the shell that runs it: export it there first",
    );
  });

  it("copies a string command through sh, so the env reaches all of it", () => {
    const service: Service = {
      type: "command",
      command: "redis-cli ping | grep PONG",
      env: { REDISCLI_AUTH: "${REDIS_PASSWORD}" },
    };

    expect(commandChecker.copy?.(service, { REDIS_PASSWORD: "x" }).command).toBe(
      `env REDISCLI_AUTH="\${REDIS_PASSWORD}" sh -c 'redis-cli ping | grep PONG'`,
    );
  });
});
