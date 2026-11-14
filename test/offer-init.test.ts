import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers";
import { CTRL_C, ENTER, hasPython, onTerminal } from "./terminal";

const QUESTION = "No .probe/ here. Create it in";
const CURRENT_MESSAGE = "Run `probe init` at the repo root.";

async function outsideProject(args: string[], keys: string) {
  const root = await tempDir();
  const run = await onTerminal(root, args, [[QUESTION, keys]]);
  return { ...run, config: join(root, ".probe", "config.yml"), root };
}

describe.skipIf(!hasPython())("a command outside a project, on a terminal", () => {
  it("should create .probe/ and run the command when the answer is yes", async () => {
    const { code, screen, config } = await outsideProject(
      ["add", "api", "-p", "3000"],
      `y${ENTER}`,
    );

    expect(screen).toContain("Created .probe/.");
    expect(code).toBe(0);
    expect(await readFile(config, "utf8")).toContain("api");
  });

  it("should add the .gitignore entries when the answer is yes", async () => {
    const { root } = await outsideProject(["ls"], `y${ENTER}`);

    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".probe/local.yml");
  });

  it("should keep the current message and exit code when Enter is pressed alone", async () => {
    const { code, screen, root } = await outsideProject(["check"], ENTER);

    expect(screen).toContain(CURRENT_MESSAGE);
    expect(code).toBe(2);
    expect(existsSync(join(root, ".probe"))).toBe(false);
  });

  it("should create nothing when the question is cancelled", async () => {
    const { code, screen, root } = await outsideProject(["check"], CTRL_C);

    expect(screen).toContain(CURRENT_MESSAGE);
    expect(code).toBe(2);
    expect(existsSync(join(root, ".probe"))).toBe(false);
  });

  it("should not ask when --json is given", async () => {
    const { code, screen } = await outsideProject(["check", "--json"], "");

    expect(screen).not.toContain(QUESTION);
    expect(code).toBe(2);
  });

  it("should not ask probe init itself", async () => {
    const { code, screen, config } = await outsideProject(["init"], "");

    expect(screen).not.toContain(QUESTION);
    expect(code).toBe(0);
    expect(existsSync(config)).toBe(true);
  });
});
