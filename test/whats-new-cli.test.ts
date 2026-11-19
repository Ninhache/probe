import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LAST_SEEN_FILE } from "../src/constants";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

const probe = (cache: string, cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  new Promise<{ stdout: string; stderr: string }>((done) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, env: { PATH: process.env.PATH, XDG_CACHE_HOME: cache, HOME: cache, ...env } },
      (_error, stdout, stderr) => done({ stdout, stderr }),
    );
  });

const seen = (cache: string) =>
  readFile(join(cache, "probe", LAST_SEEN_FILE), "utf8").catch(() => null);

describe("what's new on the command line", () => {
  it("should stay silent without a terminal, and remember a first install", async () => {
    const cache = await tempDir();
    const cwd = await tempDir();

    const { stderr } = await probe(cache, cwd, ["ls"]);

    expect(stderr).not.toContain("All notes");
    expect(await seen(cache)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("should not touch the cache for completion, the version or the help", async () => {
    const cache = await tempDir();
    const cwd = await tempDir();

    await probe(cache, cwd, ["completion", "zsh"]);
    await probe(cache, cwd, ["--version"]);
    await probe(cache, cwd, ["--help"]);

    expect(await seen(cache)).toBeNull();
  });

  it("should not touch the cache when the update check is off", async () => {
    const cache = await tempDir();
    const cwd = await tempDir();

    await probe(cache, cwd, ["ls"], { PROBE_NO_UPDATE_CHECK: "1" });
    await probe(cache, cwd, ["ls"], { CI: "true" });

    expect(await seen(cache)).toBeNull();
  });

  it("should write its marker in the completion script it prints", async () => {
    const cache = await tempDir();
    const cwd = await tempDir();

    const { stdout } = await probe(cache, cwd, ["completion", "zsh"]);

    expect(stdout.split("\n")[1]).toMatch(/^# probe completion \d+\.\d+\.\d+/);
  });
});
