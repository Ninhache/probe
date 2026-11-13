import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../src/config/loader";
import { tempProject } from "./helpers";

describe("loadConfig", () => {
  it("applies defaults in memory only", async () => {
    const yaml = "schemaVersion: 1\nservices:\n  front: { port: 3001 }\n";
    const paths = await tempProject(yaml);

    const { config, raw } = await loadConfig(paths);

    expect(config.services.front).toEqual({ host: "localhost", port: 3001, path: "/" });
    expect(raw).toEqual({ schemaVersion: 1, services: { front: { port: 3001 } } });
    expect(await readFile(paths.config, "utf8")).toBe(yaml);
  });

  it("accepts an empty `services:` key", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices:\n");
    expect((await loadConfig(paths)).config.services).toEqual({});
  });

  it("refuses a config from a newer probe", async () => {
    const paths = await tempProject("schemaVersion: 99\nservices: {}\n");
    await expect(loadConfig(paths)).rejects.toThrowError(/schema v99.*upgrade probe/);
  });

  it.each([
    ["missing schemaVersion", "services: {}\n", /schemaVersion/],
    ["unknown key", "schemaVersion: 1\nservices:\n  api: { port: 1, nope: 1 }\n", /services\.api/],
    ["port out of range", "schemaVersion: 1\nservices:\n  api: { port: 70000 }\n", /port/],
    ["bad service name", "schemaVersion: 1\nservices:\n  'a b': { port: 1 }\n", /services/],
    ["broken YAML", "schemaVersion: [1\n", /not valid YAML/],
  ])("rejects %s", async (_label, yaml, message) => {
    const paths = await tempProject(yaml);
    await expect(loadConfig(paths)).rejects.toThrowError(message);
  });
});

describe("saveConfig", () => {
  it("adds a service inline and leaves the rest of the file untouched", async () => {
    const paths = await tempProject(
      "# my services\nschemaVersion: 1\nservices:\n  front: { port: 3001 } # vite\n",
    );
    const loaded = await loadConfig(paths);

    await saveConfig(loaded, {
      ...loaded.raw,
      services: { ...(loaded.raw.services as object), api: { port: 3000, path: "/health" } },
    });

    expect(await readFile(paths.config, "utf8")).toBe(
      "# my services\nschemaVersion: 1\nservices:\n  front: { port: 3001 } # vite\n  api: { port: 3000, path: /health }\n",
    );
  });

  it("expands the empty map written by init", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    const loaded = await loadConfig(paths);

    await saveConfig(loaded, { ...loaded.raw, services: { api: { port: 3000 } } });

    expect(await readFile(paths.config, "utf8")).toBe(
      "schemaVersion: 1\nservices:\n  api: { port: 3000 }\n",
    );
  });

  it("refuses to write an invalid config", async () => {
    const yaml = "schemaVersion: 1\nservices: {}\n";
    const paths = await tempProject(yaml);
    const loaded = await loadConfig(paths);

    await expect(
      saveConfig(loaded, { ...loaded.raw, services: { api: { port: 0 } } }),
    ).rejects.toThrowError(/port/);
    expect(await readFile(paths.config, "utf8")).toBe(yaml);
  });
});
