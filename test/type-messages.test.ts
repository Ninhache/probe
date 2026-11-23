import { describe, expect, it } from "vitest";
import {
  answer,
  getServiceType,
  keepsResponse,
  serviceType,
  serviceTypeNames,
} from "../src/checkers/registry";
import { requireVariables } from "../src/commands/shared";
import { reference, serviceVariables } from "../src/config/headers";
import type { Config } from "../src/config/schema";
import { DATABASE_TYPES, SERVICE_TYPES } from "../src/config/schema";

const unset = { lookup: () => undefined };

const message = (service: Config["services"][string]) => {
  const config = { schemaVersion: 1, services: { svc: service } } as unknown as Config;
  try {
    requireVariables(config, [], unset as never, new Set());
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
};

describe("what each type of service says", () => {
  it.each([
    [{ url: "http://localhost:3000", headers: { "X-Api-Key": reference("API_KEY") } }, "sends"],
    [{ type: "command", command: ["true"], env: { TOKEN: reference("API_KEY") } }, "needs"],
    ...DATABASE_TYPES.map((type) => [{ type, password: reference("API_KEY") }, "needs"] as const),
  ] as const)("%j %s an unset variable", (service, verb) => {
    expect(message(service as never)).toMatch(new RegExp(`^svc ${verb} API_KEY, which is not set`));
  });

  it("lists every variable a secret field of a form names", () => {
    for (const name of serviceTypeNames()) {
      const { secretField } = getServiceType(name).form;
      if (secretField === undefined) continue;
      expect(serviceVariables({ [secretField]: reference("SOME_SECRET") })).toEqual([
        "SOME_SECRET",
      ]);
    }
  });
});

describe("the password field of a database form", () => {
  it.each(DATABASE_TYPES)("gives %s its own example", (type) => {
    const form = serviceType({ type }).form;
    const example = reference(`${type.toUpperCase()}_PASSWORD`);
    const placeholder = form.fields.find((field) => field.key === "password")?.placeholder;

    expect(placeholder).toBe(example);
    expect(form.problem("password", `${reference("A")}${reference("B")}`)).toContain(example);
  });

  it("writes the database of redis as a number, the others as a name", () => {
    const database = (type: string) =>
      serviceType({ type } as never).form.written({ database: "2" }).database;

    expect(database("redis")).toBe(2);
    expect(database("postgres")).toBe("2");
    expect(database("mysql")).toBe("2");
  });
});

describe("the registry of service types", () => {
  it("should register every type the config accepts, and no other", () => {
    expect([...serviceTypeNames()].sort()).toEqual([...SERVICE_TYPES].sort());
  });

  it("should keep a response only for the types that say so", () => {
    const keeping = serviceTypeNames().filter(keepsResponse);

    expect(keeping).toEqual(["http"]);
    expect(keepsResponse("socket")).toBe(false);
  });

  it("should let the type say what an up service answered", () => {
    const up = { name: "svc", ok: true, target: "", latencyMs: 1 };

    expect(answer({ ...up, type: "http", status: 204 })).toBe("204");
    expect(answer({ ...up, type: "command", exitCode: 0 })).toBe("up");
    expect(answer({ ...up, type: "socket" })).toBe("up");
  });
});
