import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tempProject } from "./helpers";
import { CTRL_C, ENTER, hasPython, onTerminal as runOnTerminal } from "./terminal";

const CONFIG = "schemaVersion: 1\nservices:\n  api: { port: 3000 }\n  db: { port: 5432 }\n";
const QUESTION = "Remove api?";

/** Runs `probe <args>` in a project on a pseudo-terminal, typing `keys` when the question shows. */
async function onTerminal(args: string[], keys: string) {
  const { root, config } = await tempProject(CONFIG);
  const run = await runOnTerminal(root, args, [[QUESTION, keys]]);
  return { ...run, config: await readFile(config, "utf8") };
}

describe.skipIf(!hasPython())("probe rm on a terminal", () => {
  it("should remove the service when the answer is yes", async () => {
    const { code, screen, config } = await onTerminal(["rm", "api"], `y${ENTER}`);

    expect(screen).toContain(QUESTION);
    expect(screen).toContain("Removed api.");
    expect(code).toBe(0);
    expect(config).not.toContain("api");
    expect(config).toContain("db");
  });

  it("should write nothing when Enter is pressed alone", async () => {
    const { code, screen, config } = await onTerminal(["rm", "api"], ENTER);

    expect(screen).toContain("Nothing removed.");
    expect(code).toBe(0);
    expect(config).toBe(CONFIG);
  });

  it("should write nothing when the question is cancelled", async () => {
    const { screen, config } = await onTerminal(["rm", "api"], CTRL_C);

    expect(screen).toContain("Nothing removed.");
    expect(config).toBe(CONFIG);
  });

  it("should not ask when --yes is given", async () => {
    const { code, screen, config } = await onTerminal(["rm", "api", "--yes"], "");

    expect(screen).not.toContain(QUESTION);
    expect(screen).toContain("Removed api.");
    expect(code).toBe(0);
    expect(config).not.toContain("api");
  });

  it("should not ask about a service that does not exist", async () => {
    const { code, screen } = await onTerminal(["rm", "nope"], "");

    expect(screen).not.toContain("Remove nope?");
    expect(code).toBe(2);
  });
});
