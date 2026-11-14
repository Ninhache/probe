import {
  chmod,
  mkdir,
  readdir,
  readFile,
  readlink,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedPreferences,
  initialDashboardSettings,
  readDashboardPreferences,
  readSkippedServices,
  writeDashboardPreferences,
  writeServiceSkip,
} from "../src/config/local";
import { tempProject } from "./helpers";

const CONFIG = "schemaVersion: 1\nservices: {}\n";

describe("dashboard preferences in local.yml", () => {
  it("reads nothing when the file is missing", async () => {
    const paths = await tempProject(CONFIG);

    expect(await readDashboardPreferences(paths)).toEqual({});
  });

  it("reads back what it saved", async () => {
    const paths = await tempProject(CONFIG);

    expect(await writeDashboardPreferences(paths, { interval: 5 })).toBe(true);
    expect(await writeDashboardPreferences(paths, { timeout: 0.5 })).toBe(true);

    expect(await readDashboardPreferences(paths)).toEqual({ interval: 5, timeout: 0.5 });
    expect(await readFile(paths.local, "utf8")).toBe("dashboard:\n  interval: 5\n  timeout: 0.5\n");
  });

  it("leaves the other keys and the comments of the file as they are", async () => {
    const paths = await tempProject(CONFIG);
    const before =
      "# mine\ncredentials:\n  db: { user: root } # local only\ndashboard:\n  interval: 2 # slow\n";
    await writeFile(paths.local, before);

    await writeDashboardPreferences(paths, { interval: 10 });

    expect(await readFile(paths.local, "utf8")).toBe(
      `${before.replace("interval: 2", "interval: 10")}`,
    );
  });

  it.each([
    ["a negative delay", "dashboard:\n  interval: -1\n  timeout: 5\n", { timeout: 5 }],
    ["a text", "dashboard:\n  interval: fast\n", {}],
    ["a section that is not a map", "dashboard: 3\n", {}],
    ["invalid YAML", "dashboard: [\n", {}],
  ])("ignores %s", async (_case, text, expected) => {
    const paths = await tempProject(CONFIG);
    await writeFile(paths.local, text);

    expect(await readDashboardPreferences(paths)).toEqual(expected);
  });

  it("keeps the permissions of the file, and creates it for its owner only", async () => {
    const paths = await tempProject(CONFIG);

    await writeDashboardPreferences(paths, { interval: 5 });
    expect((await stat(paths.local)).mode & 0o777).toBe(0o600);

    await chmod(paths.local, 0o640);
    await writeDashboardPreferences(paths, { interval: 10 });
    expect((await stat(paths.local)).mode & 0o777).toBe(0o640);
  });

  it("writes through a symlink instead of replacing it", async () => {
    const paths = await tempProject(CONFIG);
    const shared = join(paths.root, "shared.yml");
    await writeFile(shared, "credentials: {}\n");
    await symlink(shared, paths.local);

    await writeDashboardPreferences(paths, { timeout: 5 });

    expect(await readlink(paths.local)).toBe(shared);
    expect(await readFile(shared, "utf8")).toBe("credentials: {}\ndashboard:\n  timeout: 5\n");
  });

  it("leaves no copy of the file behind, written or not", async () => {
    const paths = await tempProject(CONFIG);
    await writeDashboardPreferences(paths, { interval: 5 });
    expect(await readdir(paths.dir)).toEqual(["config.yml", "local.yml"]);

    const blocked = await tempProject(CONFIG);
    await mkdir(blocked.local);
    await expect(writeDashboardPreferences(blocked, { interval: 5 })).rejects.toThrow();
    expect(await readdir(blocked.dir)).toEqual(["config.yml", "local.yml"]);
  });

  it.each([
    ["invalid YAML", "dashboard: [\n"],
    ["a top level that is not a map", "- a\n"],
    ["a section that is not a map", "dashboard: 3\n"],
  ])("does not write over %s", async (_case, text) => {
    const paths = await tempProject(CONFIG);
    await writeFile(paths.local, text);

    expect(await writeDashboardPreferences(paths, { interval: 5 })).toBe(false);
    expect(await readFile(paths.local, "utf8")).toBe(text);
  });
});

describe("dashboard settings at start", () => {
  it.each([
    ["the defaults with nothing saved", undefined, {}, { intervalMs: 2_000, timeoutMs: 3_000 }],
    [
      "what local.yml holds",
      undefined,
      { interval: 10, timeout: 1 },
      { intervalMs: 10_000, timeoutMs: 1_000 },
    ],
    [
      "--interval before local.yml",
      7_000,
      { interval: 10, timeout: 1 },
      { intervalMs: 7_000, timeoutMs: 1_000 },
    ],
  ])("uses %s", (_case, asked, saved, expected) => {
    expect(initialDashboardSettings(asked, saved)).toEqual(expected);
  });

  it("saves only what the panel changed, not an interval given by --interval", () => {
    const start = initialDashboardSettings(7_000, { interval: 10 });

    expect(changedPreferences(start, { ...start, timeoutMs: 5_000 })).toEqual({ timeout: 5 });
    expect(changedPreferences(start, { ...start, intervalMs: 10_000 })).toEqual({ interval: 10 });
    expect(changedPreferences(start, start)).toEqual({});
  });
});

describe("skipped services in local.yml", () => {
  it("skips nothing when the file is missing", async () => {
    const paths = await tempProject(CONFIG);

    expect(await readSkippedServices(paths)).toEqual(new Set());
  });

  it("reads back the services it set aside", async () => {
    const paths = await tempProject(CONFIG);

    expect(await writeServiceSkip(paths, "db", true)).toBe(true);
    expect(await writeServiceSkip(paths, "api", true)).toBe(true);

    expect(await readSkippedServices(paths)).toEqual(new Set(["db", "api"]));
    expect(await readFile(paths.local, "utf8")).toBe(
      "services:\n  db:\n    skip: true\n  api:\n    skip: true\n",
    );
  });

  it("removes what it wrote when a service comes back, keeping the rest", async () => {
    const paths = await tempProject(CONFIG);
    const before = "# mine\ndashboard:\n  interval: 5\n";
    await writeFile(paths.local, before);
    await writeServiceSkip(paths, "db", true);

    expect(await writeServiceSkip(paths, "db", false)).toBe(true);

    expect(await readFile(paths.local, "utf8")).toBe(before);
  });

  it("leaves an empty file, not an empty map, when nothing else is in it", async () => {
    const paths = await tempProject(CONFIG);
    await writeServiceSkip(paths, "db", true);

    await writeServiceSkip(paths, "db", false);

    expect(await readFile(paths.local, "utf8")).toBe("");
    expect(await writeServiceSkip(paths, "db", true)).toBe(true);
    expect(await readSkippedServices(paths)).toEqual(new Set(["db"]));
  });

  it("keeps the other keys of a service that comes back", async () => {
    const paths = await tempProject(CONFIG);
    await writeFile(paths.local, "services:\n  db:\n    port: 5433 # mine\n    skip: true\n");

    await writeServiceSkip(paths, "db", false);

    expect(await readFile(paths.local, "utf8")).toBe("services:\n  db:\n    port: 5433 # mine\n");
  });

  it("creates no file to bring back a service that was not set aside", async () => {
    const paths = await tempProject(CONFIG);

    expect(await writeServiceSkip(paths, "db", false)).toBe(true);

    expect(await readdir(paths.dir)).toEqual(["config.yml"]);
  });

  it.each([
    ["a value that is not true", "services:\n  db:\n    skip: yes please\n"],
    ["services that are not a map", "services: 3\n"],
    ["a service that is not a map", "services:\n  db: 3\n"],
    ["invalid YAML", "services: [\n"],
  ])("skips nothing on %s", async (_case, text) => {
    const paths = await tempProject(CONFIG);
    await writeFile(paths.local, text);

    expect(await readSkippedServices(paths)).toEqual(new Set());
  });

  it.each([
    ["services that are not a map", "services: 3\n"],
    ["a service that is not a map", "services:\n  db: 3\n"],
    ["invalid YAML", "services: [\n"],
  ])("does not write over %s", async (_case, text) => {
    const paths = await tempProject(CONFIG);
    await writeFile(paths.local, text);

    expect(await writeServiceSkip(paths, "db", true)).toBe(false);

    expect(await readFile(paths.local, "utf8")).toBe(text);
  });
});
