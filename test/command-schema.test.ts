import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { commandForm } from "../src/checkers/command-form";
import { getServiceType } from "../src/checkers/registry";
import { writeService } from "../src/commands/service-writes";
import { configSchemaV1, SERVICE_TYPES } from "../src/config/schema";
import { commandFromText, commandProblem, commandText } from "../src/config/service-input";
import { formFields, formProblem, formValues } from "../src/dashboard/form";
import { tempProject } from "./helpers";

const parse = (services: unknown) => configSchemaV1.safeParse({ schemaVersion: 1, services });

const problems = (services: unknown) =>
  parse(services).error?.issues.map(({ path, message }) => ({
    path: path.slice(1).join("."),
    message,
  }));

describe("a command service in the config", () => {
  it("should accept a command as a list", () => {
    const command = ["docker", "compose", "exec", "-T", "db", "pg_isready"];

    const result = parse({
      db: { type: "command", command, timeout: 5, hint: "up?", tags: ["a"] },
    });

    expect(result.data?.services.db).toEqual({
      type: "command",
      command,
      timeout: 5,
      hint: "up?",
      tags: ["a"],
    });
  });

  it("should accept a command as a string", () => {
    expect(parse({ cache: { type: "command", command: "redis-cli ping" } }).success).toBe(true);
  });

  it("should leave an http service as it has always been parsed", () => {
    const { data } = parse({ api: { port: 3000, path: "/health", expect: 200 } });

    expect(data?.services.api).toEqual({
      host: "localhost",
      port: 3000,
      path: "/health",
      expect: 200,
    });
  });

  it("should accept `type: http` written out", () => {
    expect(parse({ api: { type: "http", port: 3000 } }).data?.services.api).toMatchObject({
      type: "http",
      port: 3000,
    });
  });

  it.each([
    ["a missing command", { type: "command" }, "command"],
    ["an empty string", { type: "command", command: "" }, "command"],
    ["a blank string", { type: "command", command: "   " }, "command"],
    ["an empty list", { type: "command", command: [] }, "command"],
    ["an empty word", { type: "command", command: ["a", ""] }, "command"],
    ["a number", { type: "command", command: 3 }, "command"],
    ["an unknown type", { type: "tcp", port: 1 }, "type"],
  ])("should refuse %s", (_, service, path) => {
    const found = problems({ job: service });

    expect(found?.map((issue) => issue.path).every((at) => at.startsWith(`job.${path}`))).toBe(
      true,
    );
  });

  it.each([
    ["url", "http://localhost"],
    ["urls", { a: "http://localhost" }],
    ["host", "localhost"],
    ["port", 3000],
    ["path", "/"],
    ["method", "GET"],
    ["headers", { A: "b" }],
    ["expect", 200],
    ["contains", "ok"],
  ])("should refuse `%s` on a command service", (key, value) => {
    const found = problems({ job: { type: "command", command: "true", [key]: value } });

    expect(found).toEqual([
      { path: `job.${key}`, message: expect.stringContaining("type: command") },
    ]);
  });

  it("should refuse a command on an http service, with or without `type: http`", () => {
    for (const service of [
      { port: 3000, command: "true" },
      { type: "http", port: 3000, command: "true" },
    ]) {
      expect(problems({ api: service })).toEqual([
        { path: "api.command", message: expect.stringContaining("type: command") },
      ]);
    }
  });

  it("should not repeat the command in a message", () => {
    const found = JSON.stringify(
      problems({ job: { type: "command", command: "s3cret", port: 1 } }),
    );

    expect(found).not.toContain("s3cret");
  });

  it("should leave a command service alone when the config has a url parameter", () => {
    const result = configSchemaV1.safeParse({
      schemaVersion: 1,
      parameters: { env: { values: ["dev", "prod"], strategy: { kind: "url" } } },
      services: { job: { type: "command", command: "true" } },
    });

    expect(result.success).toBe(true);
  });

  it("should list in the schema the types the registry knows", () => {
    for (const type of SERVICE_TYPES) expect(getServiceType(type).type).toBe(type);
    expect(() => getServiceType("nope")).toThrow(`Known: ${SERVICE_TYPES.join(", ")}.`);
  });
});

describe("the text of a command", () => {
  it("should read a JSON list as a list and anything else as a string", () => {
    expect(commandFromText('["docker", "ps"]')).toEqual(["docker", "ps"]);
    expect(commandFromText("redis-cli ping")).toBe("redis-cli ping");
    expect(commandFromText("[ -f ready ]")).toBe("[ -f ready ]");
    expect(commandFromText("[1, 2]")).toBe("[1, 2]");
  });

  it("should write back what it read", () => {
    for (const command of [["a", "b c"], "x y", '["not", "a", "list"] | cat']) {
      const roundTrip = commandFromText(commandText(command));
      expect(roundTrip).toEqual(command);
    }
  });

  it("should refuse an empty command in the form", () => {
    expect(commandProblem("")).toBeDefined();
    expect(commandProblem("[]")).toBeDefined();
    expect(commandProblem("redis-cli ping")).toBeUndefined();
    expect(
      formProblem(commandForm.fields, { name: "", command: "", headers: [] }, [], commandForm),
    ).toMatchObject({ row: 0 });
  });
});

describe("writing a command service", () => {
  const CONFIG = (service: string) =>
    `schemaVersion: 1\nservices:\n  api: { port: 3000 }\n${service}`;

  it("should add it with `type: command` and write no http key", async () => {
    const paths = await tempProject(CONFIG(""));

    const written = await writeService(paths, {
      kind: "add",
      name: "db",
      fields: formFields({ name: "", command: '["pg_isready", "-q"]', headers: [] }, commandForm),
    });

    expect(written?.config.services.db).toEqual({ type: "command", command: ["pg_isready", "-q"] });
    const text = await readFile(paths.config, "utf8");
    expect(text).not.toMatch(/db:[\s\S]*(host|port|path|method|expect)/);
    expect(text).toContain("api: { port: 3000 }");
    expect(text).not.toContain("type: http");
  });

  it("should leave the file byte for byte when an edit changes nothing", async () => {
    const config = CONFIG(
      stringifyService("db", { type: "command", command: ["docker", "compose", "exec", "db"] }),
    );
    const paths = await tempProject(config);
    const { config: loaded } = await import("../src/config/loader").then((m) =>
      m.loadConfig(paths),
    );
    const service = loaded.services.db;
    if (!service) throw new Error("db is missing");
    const values = formValues({ command: service.command }, commandForm);

    await writeService(paths, {
      kind: "edit",
      name: "db",
      fields: formFields(values, commandForm),
    });

    expect(await readFile(paths.config, "utf8")).toBe(config);
  });

  it("should keep a list a list and a string a string when the command is edited", async () => {
    const paths = await tempProject(
      CONFIG(
        "  a:\n    type: command\n    command: [x, y]\n  b:\n    type: command\n    command: x y\n",
      ),
    );
    const edit = (name: string, command: string) =>
      writeService(paths, {
        kind: "edit",
        name,
        fields: formFields({ name: "", command, headers: [] }, commandForm),
      });

    await edit("a", '["x", "z"]');
    const written = await edit("b", "x z");

    expect(written?.config.services.a?.command).toEqual(["x", "z"]);
    expect(written?.config.services.b?.command).toBe("x z");
  });

  it("should never add `type: http` when an http service is edited", async () => {
    const paths = await tempProject(CONFIG(""));

    await writeService(paths, {
      kind: "edit",
      name: "api",
      fields: { host: "localhost", port: 3001, path: "/", expect: undefined },
    });

    expect(await readFile(paths.config, "utf8")).not.toContain("type");
  });
});

function stringifyService(name: string, service: object): string {
  return stringify({ [name]: service })
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
