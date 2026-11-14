import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadConfig, saveConfig, writeServiceTimeout } from "../src/config/loader";
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
    ["timeout of zero", "schemaVersion: 1\nservices:\n  api: { port: 1, timeout: 0 }\n", /timeout/],
    [
      "negative timeout",
      "schemaVersion: 1\nservices:\n  api: { port: 1, timeout: -2 }\n",
      /timeout/,
    ],
    [
      "timeout as text",
      "schemaVersion: 1\nservices:\n  api: { port: 1, timeout: soon }\n",
      /timeout/,
    ],
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

describe("writeServiceTimeout", () => {
  const yaml = [
    "# my services",
    "schemaVersion: 1",
    "services:",
    "  front: { port: 3001 } # vite",
    "  db:",
    "    # slow to start",
    "    port: 5432",
    "",
  ].join("\n");

  it("sets the timeout of one service and leaves the rest of the file untouched", async () => {
    const paths = await tempProject(yaml);

    expect(await writeServiceTimeout(paths, "front", 10)).toBe(true);
    expect(await writeServiceTimeout(paths, "db", 0.5)).toBe(true);

    expect(await readFile(paths.config, "utf8")).toBe(
      yaml
        .replace("front: { port: 3001 }", "front: { port: 3001, timeout: 10 }")
        .replace("    port: 5432\n", "    port: 5432\n    timeout: 0.5\n"),
    );
  });

  it("removes the timeout, back to the file as it was", async () => {
    const paths = await tempProject(yaml);
    await writeServiceTimeout(paths, "front", 10);

    expect(await writeServiceTimeout(paths, "front", undefined)).toBe(true);

    expect(await readFile(paths.config, "utf8")).toBe(yaml);
  });

  it("keeps an edit made to the file since it was loaded", async () => {
    const paths = await tempProject(yaml);
    await loadConfig(paths);
    await writeFile(paths.config, yaml.replace("port: 3001", "port: 4000"));

    await writeServiceTimeout(paths, "front", 5);

    expect(await readFile(paths.config, "utf8")).toContain("front: { port: 4000, timeout: 5 }");
  });

  it("does nothing for a service that is no longer declared", async () => {
    const paths = await tempProject(yaml);

    expect(await writeServiceTimeout(paths, "gone", 5)).toBe(false);

    expect(await readFile(paths.config, "utf8")).toBe(yaml);
  });
});
