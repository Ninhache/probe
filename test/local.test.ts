import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readDashboardPreferences, writeDashboardPreferences } from "../src/config/local";
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
