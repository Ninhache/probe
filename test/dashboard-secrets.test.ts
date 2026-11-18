import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempProject } from "./helpers";
import { ENTER, hasPython, onTerminal } from "./terminal";

const SECRET = "s3cr3t-token-0123456789";
const DOWN = "\u001b[B";
const CONFIG = "schemaVersion: 1\nservices:\n  api: { port: 1 }\n";
const REFERENCE = "$" + "{API_TOKEN}";
const TAB = "\t";
const CTRL_U = "\u0015";
const read = (file: string) => readFile(file, "utf8").catch(() => "");

describe.skipIf(!hasPython())("a secret typed in the dashboard", () => {
  it("should go to local.yml, a reference to config.yml, and nowhere else", async () => {
    const paths = await tempProject(CONFIG);

    // The form opens on the address: three tabs reach the header, whose current value is emptied.
    const { screen } = await onTerminal(
      paths.root,
      [],
      [
        ["api", "e"],
        ["edit api", `${TAB.repeat(3)}${CTRL_U}Authorization: Bearer ${SECRET}${ENTER}`],
        ["holds a secret", ""],
        ["API_TOKEN", ENTER],
        ["Saved api", "q"],
      ],
    );

    expect(screen).toContain("Saved api, API_TOKEN kept in .probe/local.yml");
    expect(screen).not.toContain(SECRET);
    expect(await read(paths.config)).toContain(`Authorization: "Bearer ${REFERENCE}"`);
    expect(await read(paths.config)).not.toContain(SECRET);
    expect(await read(paths.lock)).not.toContain(SECRET);
    expect(await read(join(paths.root, "Makefile"))).not.toContain(SECRET);
    expect(await read(paths.local)).toContain(`API_TOKEN: ${SECRET}`);
    expect((await stat(paths.local)).mode & 0o777).toBe(0o600);
    expect(await read(join(paths.root, ".gitignore"))).toContain(".probe/local.yml");
  });

  it("should take the value of a variable from the panel, never drawn", async () => {
    const paths = await tempProject(
      `schemaVersion: 1\nservices:\n  api: { port: 1, headers: { X-Api-Key: '${REFERENCE}' } }\n`,
    );

    const { screen } = await onTerminal(
      paths.root,
      [],
      [
        ["api", ENTER],
        ["not set", `${DOWN}${ENTER}`],
        ["Value of", `${SECRET}${ENTER}`],
        ["Kept API_TOKEN", "q"],
      ],
    );

    expect(screen).not.toContain(SECRET);
    expect(await read(paths.local)).toContain(`API_TOKEN: ${SECRET}`);
    expect((await stat(paths.local)).mode & 0o777).toBe(0o600);
    expect(await read(paths.config)).not.toContain(SECRET);
  });
});
