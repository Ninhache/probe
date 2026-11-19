import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASCII_GLYPHS, glyphsFor, UNICODE_GLYPHS } from "../src/ui/glyphs";
import { stripStyles } from "../src/ui/terminal";
import { RELEASE_NOTES } from "../src/update/release-notes";
import { newsOf, renderNews } from "../src/update/whats-new";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const NON_ASCII = /[^ -~\n\t]/;
const UTF8 = { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
const ASCII_ENVS = {
  "PROBE_ASCII=1": { ...UTF8, PROBE_ASCII: "1" },
  "LANG=C": { LANG: "C", LC_ALL: "C" },
};

let port = 0;
const server = createServer((_, response) => response.writeHead(200).end());
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

async function project(): Promise<string> {
  const dir = await tempDir();
  await mkdir(join(dir, ".probe"));
  await writeFile(
    join(dir, ".probe", "config.yml"),
    `schemaVersion: 1\nservices:\n  acme: { port: ${port}, host: 127.0.0.1, path: / }\n  globex: { port: 1, host: 127.0.0.1, path: / }\n`,
  );
  return dir;
}

const probe = (cwd: string, args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<string>((done) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, env: { PATH: process.env.PATH, PROBE_NO_UPDATE_CHECK: "1", ...env } },
      (_error, stdout, stderr) => done(stdout + stderr),
    );
  });

describe("glyphsFor", () => {
  it("should follow the locale and PROBE_ASCII", () => {
    expect(glyphsFor(UTF8)).toBe(UNICODE_GLYPHS);
    expect(glyphsFor({ ...UTF8, PROBE_ASCII: "1" })).toBe(ASCII_GLYPHS);
    expect(glyphsFor({ ...UTF8, PROBE_ASCII: "yes" })).toBe(UNICODE_GLYPHS);
    expect(glyphsFor({ LANG: "C" })).toBe(ASCII_GLYPHS);
  });

  it("should keep the marks of one width", () => {
    for (const glyphs of [UNICODE_GLYPHS, ASCII_GLYPHS]) {
      expect(glyphs.fail.length).toBe(glyphs.ok.length);
      expect(glyphs.skipped.length).toBe(glyphs.ok.length);
    }
  });
});

describe.each(Object.entries(ASCII_ENVS))("the command output with %s", (_, env) => {
  it("should be ASCII only", async () => {
    const cwd = await project();

    const outputs = await Promise.all([
      probe(cwd, ["--help"], env),
      probe(cwd, ["check", "--help"], env),
      probe(cwd, ["check"], env),
      probe(cwd, ["status"], env),
      probe(cwd, ["doctor"], env),
    ]);

    for (const output of outputs) expect(output).not.toMatch(NON_ASCII);
    expect(outputs[2]).toMatch(/^ok acme/m);
    expect(outputs[2]).toMatch(/^x {2}globex/m);
  });
});

describe("the command output with a UTF-8 locale", () => {
  it("should keep the glyphs", async () => {
    const cwd = await project();

    expect(await probe(cwd, ["--help"], UTF8)).toContain(" · ");
    expect(await probe(cwd, ["check"], UTF8)).toMatch(/^✓ acme/m);
    expect(await probe(cwd, ["check"], UTF8)).toMatch(/^✗ globex/m);
  });
});

describe("the notes", () => {
  it("should be ASCII only, whatever the terminal", () => {
    const upgrade = { current: "1.2.0", from: "1.0.0", notes: RELEASE_NOTES };
    const warning =
      "Saved zsh completion is from an older probe: run `probe completion zsh > ~/.zfunc/_probe`";

    const text = renderNews(newsOf(upgrade, [warning]), true);

    expect(stripStyles(text)).not.toMatch(NON_ASCII);
  });
});
