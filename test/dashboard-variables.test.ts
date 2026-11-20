import { describe, expect, it } from "vitest";
import type { VariableSource } from "../src/config/local";
import type { Config } from "../src/config/schema";
import { proposedVariable, variableTools } from "../src/dashboard/variables";

const reference = (name: string) => `$\{${name}}`;

const config = {
  schemaVersion: 1,
  services: {
    api: {
      host: "localhost",
      port: 3000,
      path: "/",
      headers: { "X-Api-Key": reference("API_KEY") },
    },
    db: { host: "localhost", port: 5432, path: "/", headers: { Cookie: reference("DB_COOKIE") } },
    web: { host: "localhost", port: 8080, path: "/" },
    job: { type: "command", command: "mysqladmin ping", env: { MYSQL_PWD: reference("JOB_PWD") } },
  },
} as Config;

function tools(set: Record<string, VariableSource> = {}) {
  return variableTools(
    () => config,
    async (names) => Object.fromEntries(names.map((name) => [name, set[name]])),
  );
}

describe("proposedVariable", () => {
  it.each([
    ["api", "Authorization", "API_TOKEN"],
    ["my-api", "X-Api-Key", "MY_API_API_KEY"],
    ["web", "Cookie", "WEB_COOKIE"],
    ["2fa", "X-Auth-Token", "_2FA_AUTH_TOKEN"],
    ["db", "MYSQL_PWD", "DB_MYSQL_PWD"],
  ])("should name the secret of %s sent as %s %s", (service, header, name) => {
    expect(proposedVariable(service, header)).toBe(name);
  });
});

describe("variableTools", () => {
  it("should list the variables the env of a command uses, with the headers' ones", async () => {
    expect(await tools({ JOB_PWD: "environment" }).serviceVariables("job")).toEqual([
      { name: "JOB_PWD", source: "environment" },
    ]);
    expect((await tools().allVariables()).map(({ name }) => name)).toEqual([
      "API_KEY",
      "DB_COOKIE",
      "JOB_PWD",
    ]);
    expect(await tools().variableProblem("JOB_PWD", "web")).toContain("already used by job");
  });

  it("should list the variables a service sends, with where each one is set", async () => {
    expect(await tools({ API_KEY: "local" }).serviceVariables("api")).toEqual([
      { name: "API_KEY", source: "local" },
    ]);
    expect(await tools().serviceVariables("db")).toEqual([
      { name: "DB_COOKIE", source: undefined },
    ]);
    expect(await tools().serviceVariables("web")).toEqual([]);
  });

  it("should refuse a name another service sends: the secret would go there too", async () => {
    expect(await tools().variableProblem("DB_COOKIE", "web")).toContain("already used by db");
  });

  it("should refuse a name already set, here or in the environment", async () => {
    expect(await tools({ WEB_TOKEN: "local" }).variableProblem("WEB_TOKEN", "web")).toContain(
      "already set",
    );
    expect(await tools({ WEB_TOKEN: "environment" }).variableProblem("WEB_TOKEN", "web")).toContain(
      "set in the environment",
    );
  });

  it("should let a service replace the value of a variable it alone sends", async () => {
    expect(await tools({ API_KEY: "local" }).variableProblem("API_KEY", "api")).toBeUndefined();
    expect(await tools({ API_KEY: "environment" }).variableProblem("API_KEY", "api")).toContain(
      "set in the environment",
    );
  });

  it("should refuse what is not a variable name", async () => {
    expect(await tools().variableProblem("api token", "web")).toContain("Letters, digits and _");
  });

  it("should propose the first name that is free", async () => {
    expect(await tools().variableName("web", "Authorization", [])).toBe("WEB_TOKEN");
    expect(await tools({ WEB_TOKEN: "local" }).variableName("web", "Authorization", [])).toBe(
      "WEB_TOKEN_2",
    );
    expect(await tools().variableName("web", "Authorization", ["WEB_TOKEN"])).toBe("WEB_TOKEN_2");
  });
});
