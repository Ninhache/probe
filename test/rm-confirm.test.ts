import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const PTY = resolve(import.meta.dirname, "fixtures", "on-terminal.py");
const CONFIG = "schemaVersion: 1\nservices:\n  api: { port: 3000 }\n  db: { port: 5432 }\n";
const QUESTION = "Remove api?";
const ENTER = "\r";
const CTRL_C = "\u0003";

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface Run {
  code: number;
  screen: string;
  config: string;
}

/** Runs `probe <args>` on a pseudo-terminal, typing `keys` when the question shows. */
async function onTerminal(args: string[], keys: string): Promise<Run> {
  const { root, config } = await tempProject(CONFIG);
  // CI is set on the runners, and it turns every question off.
  const env = { ...process.env, PROBE_NO_UPDATE_CHECK: "1", TERM: "xterm-256color", CI: "" };
  const steps = JSON.stringify([[QUESTION, keys]]);
  return new Promise((done) => {
    execFile(
      "python3",
      [PTY, steps, process.execPath, CLI, ...args],
      { cwd: join(root), env },
      async (error, stdout) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        done({ code: Number(code), screen: stdout, config: await readFile(config, "utf8") });
      },
    );
  });
}

// The pseudo-terminal comes from python3, present on the Linux and macOS runners.
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
