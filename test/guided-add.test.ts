import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tempProject } from "./helpers";
import { CTRL_C, ENTER, hasPython, onTerminal, type Step } from "./terminal";

const CONFIG = "schemaVersion: 1\nservices:\n  db: { port: 5432 }\n";
const NAME = "Service name";
const PORT = "Port";
const PATH = "Path to request";
const EXPECT = "Expected status";

async function guided(steps: Step[], args = ["add"]) {
  const { root, config } = await tempProject(CONFIG);
  const run = await onTerminal(root, args, steps);
  return { ...run, config: await readFile(config, "utf8") };
}

describe.skipIf(!hasPython())("probe add alone on a terminal", () => {
  it("should add the service when every question is answered", async () => {
    const { code, screen, config } = await guided([
      [NAME, `api${ENTER}`],
      [PORT, `3000${ENTER}`],
      [PATH, `/health${ENTER}`],
      [EXPECT, `200,204${ENTER}`],
    ]);

    expect(screen).toContain("Added api.");
    expect(code).toBe(0);
    expect(config).toContain("api: { port: 3000, path: /health, expect: [ 200, 204 ] }");
  });

  it("should keep the defaults out of the config when Enter is pressed alone", async () => {
    const { code, config } = await guided([
      [NAME, `api${ENTER}`],
      [PORT, `3000${ENTER}`],
      [PATH, ENTER],
      [EXPECT, ENTER],
    ]);

    expect(code).toBe(0);
    expect(config).toContain("api: { port: 3000 }");
  });

  it("should ask again when the name is already taken", async () => {
    const { screen, config } = await guided([
      [NAME, `db${ENTER}`],
      ["db already exists", CTRL_C],
    ]);

    expect(screen).not.toContain(PORT);
    expect(config).toBe(CONFIG);
  });

  it("should ask again when the port is out of range", async () => {
    const { screen, config } = await guided([
      [NAME, `api${ENTER}`],
      [PORT, `70000${ENTER}`],
      ["65535", CTRL_C],
    ]);

    expect(screen).not.toContain(PATH);
    expect(config).toBe(CONFIG);
  });

  it("should write nothing when a question is cancelled", async () => {
    const { code, screen, config } = await guided([
      [NAME, `api${ENTER}`],
      [PORT, CTRL_C],
    ]);

    expect(screen).toContain("Nothing added.");
    expect(code).toBe(0);
    expect(config).toBe(CONFIG);
  });

  it("should ask nothing when the arguments are given", async () => {
    const { code, screen, config } = await guided([], ["add", "api", "-p", "3000"]);

    expect(screen).not.toContain(NAME);
    expect(code).toBe(0);
    expect(config).toContain("api: { port: 3000 }");
  });
});
