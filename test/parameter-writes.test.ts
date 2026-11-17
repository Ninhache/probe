import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeParameter } from "../src/commands/parameter-writes";
import { loadConfig } from "../src/config/loader";
import { tempProject } from "./helpers";

const CONFIG = [
  "schemaVersion: 1",
  "parameters:",
  "  # who the request is for",
  "  tenant: { values: [acme, globex], strategy: { kind: query, name: t } } # shared",
  "services:",
  "  api: { port: 3000 }",
  "",
].join("\n");

describe("writeParameter", () => {
  it("should add a parameter and keep the comments", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeParameter(paths, {
      kind: "add",
      name: "version",
      parameter: { values: ["v1", "v2"], strategy: { kind: "path" } },
    });

    expect(written?.config?.parameters?.version?.values).toEqual(["v1", "v2"]);
    const text = await readFile(paths.config, "utf8");
    expect(text).toContain("# who the request is for");
    expect(text).toContain("# shared");
  });

  it("should leave numbers as written when the edit keeps the values", async () => {
    const paths = await tempProject(CONFIG.replace("[acme, globex]", "[1, 2]"));

    await writeParameter(paths, {
      kind: "edit",
      name: "tenant",
      parameter: { values: ["1", "2"], strategy: { kind: "header", name: "X-Tenant" } },
    });

    const text = await readFile(paths.config, "utf8");
    expect(text).toMatch(/values: \[ ?1, 2 ?\]/);
    expect(text).toContain("X-Tenant");
  });

  it("should remove the parameters key with the last parameter", async () => {
    const paths = await tempProject(CONFIG);

    await writeParameter(paths, { kind: "remove", name: "tenant" });

    const { config } = await loadConfig(paths);
    expect(config.parameters).toBeUndefined();
    expect(await readFile(paths.config, "utf8")).not.toContain("parameters:");
  });

  it("should refuse a second parameter on the same query, and write nothing", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeParameter(paths, {
      kind: "add",
      name: "team",
      parameter: { values: ["a"], strategy: { kind: "query", name: "t" } },
    });

    expect(written?.problem).toEqual({
      field: "strategyName",
      message: "Sets the same query as tenant",
    });
    expect(await readFile(paths.config, "utf8")).toBe(CONFIG);
  });

  it("should refuse a header that can carry a secret", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeParameter(paths, {
      kind: "edit",
      name: "tenant",
      parameter: { values: ["acme"], strategy: { kind: "header", name: "Authorization" } },
    });

    expect(written?.problem?.field).toBe("strategyName");
    expect(await readFile(paths.config, "utf8")).toBe(CONFIG);
  });

  it("should name the service that keeps an address for a value being removed", async () => {
    const config = [
      "schemaVersion: 1",
      "parameters:",
      "  env: { values: [local, prod], strategy: { kind: url } }",
      "services:",
      "  api: { port: 3000, urls: { prod: 'https://example.com/health' } }",
      "",
    ].join("\n");
    const paths = await tempProject(config);

    const edit = await writeParameter(paths, {
      kind: "edit",
      name: "env",
      parameter: { values: ["local"], strategy: { kind: "url" } },
    });
    const remove = await writeParameter(paths, { kind: "remove", name: "env" });

    expect(edit?.problem).toEqual({
      field: "values",
      message: "api has an address for prod under urls: change it first",
    });
    expect(remove?.problem?.message).toBe(
      "api has an address for prod under urls: change it first",
    );
    expect(await readFile(paths.config, "utf8")).toBe(config);
  });

  it("should write nothing when the parameter to add already exists", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeParameter(paths, {
      kind: "add",
      name: "tenant",
      parameter: { values: ["x"], strategy: { kind: "path" } },
    });

    expect(written).toBeNull();
  });
});
