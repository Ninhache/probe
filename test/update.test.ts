import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UPDATE_CHECK_TTL_MS } from "../src/constants";
import {
  cacheDir,
  isNewer,
  readCache,
  refreshCache,
  scheduleRefresh,
  updateCheckDisabled,
  updateNotice,
} from "../src/update/notifier";
import { tempDir } from "./helpers";

const NOW = 1_800_000_000_000;
// A script that exits at once, standing in for the CLI the refresh would spawn.
const noopCli = async (dir: string) => {
  const file = join(dir, "noop.mjs");
  await writeFile(file, "");
  return file;
};
const writeCacheFile = (dir: string, cache: object) =>
  writeFile(join(dir, "latest.json"), JSON.stringify(cache));

describe("updateCheckDisabled", () => {
  it.each([
    [{}, false],
    [{ PROBE_NO_UPDATE_CHECK: "1" }, true],
    [{ PROBE_NO_UPDATE_CHECK: "0" }, false],
    [{ CI: "true" }, true],
    [{ CI: "1" }, true],
    [{ CI: "" }, false],
  ])("%j -> %s", (env, expected) => {
    expect(updateCheckDisabled(env)).toBe(expected);
  });
});

describe("cacheDir", () => {
  it("follows XDG_CACHE_HOME, else ~/.cache", () => {
    expect(cacheDir({ XDG_CACHE_HOME: "/xdg" })).toBe("/xdg/probe");
    expect(cacheDir({})).toMatch(/\/\.cache\/probe$/);
  });
});

describe("isNewer", () => {
  it.each([
    ["1.0.1", "1.0.0", true],
    ["1.10.0", "1.9.9", true],
    ["2.0.0", "1.99.99", true],
    ["1.0.0", "1.0.0", false],
    ["1.0.0", "1.0.1", false],
    ["1.0.0", "0.0.0-dev", true],
  ])("%s vs %s -> %s", (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected);
  });
});

describe("updateNotice", () => {
  it("is silent without a cache", async () => {
    expect(updateNotice("1.0.0", await tempDir())).toBeNull();
  });

  it("is silent when up to date", async () => {
    const dir = await tempDir();
    await writeCacheFile(dir, { latest: "1.0.0", checkedAt: NOW });
    expect(updateNotice("1.0.0", dir)).toBeNull();
  });

  it("tells how to upgrade when a newer version is cached", async () => {
    const dir = await tempDir();
    await writeCacheFile(dir, { latest: "1.2.0", checkedAt: NOW });

    expect(updateNotice("1.0.0", dir)).toBe(
      "probe 1.2.0 available (you have 1.0.0) → `brew upgrade probe` or `npm i -g @ninhache/probe`",
    );
  });

  it("ignores a corrupt cache", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "latest.json"), "{not json");
    expect(updateNotice("1.0.0", dir)).toBeNull();
  });
});

describe("scheduleRefresh", () => {
  it("starts a refresh and stamps the cache when there is none", async () => {
    const dir = join(await tempDir(), "nested", "probe");

    expect(scheduleRefresh(dir, await noopCli(await tempDir()), NOW)).toBe(true);
    expect(readCache(dir)).toEqual({ latest: null, checkedAt: NOW });
  });

  it("does nothing while the cache is younger than 24 h", async () => {
    const dir = await tempDir();
    const cache = { latest: "1.0.0", checkedAt: NOW - UPDATE_CHECK_TTL_MS + 1 };
    await writeCacheFile(dir, cache);

    expect(scheduleRefresh(dir, await noopCli(dir), NOW)).toBe(false);
    expect(readCache(dir)).toEqual(cache);
  });

  it("refreshes a stale cache and keeps the known version meanwhile", async () => {
    const dir = await tempDir();
    await writeCacheFile(dir, { latest: "1.0.0", checkedAt: NOW - UPDATE_CHECK_TTL_MS });

    expect(scheduleRefresh(dir, await noopCli(dir), NOW)).toBe(true);
    expect(readCache(dir)).toEqual({ latest: "1.0.0", checkedAt: NOW });
  });

  it("returns at once: it does not wait for the refresh", async () => {
    const dir = await tempDir();
    const slow = join(dir, "slow.mjs");
    await writeFile(slow, "setTimeout(() => {}, 2000);");

    const started = performance.now();
    scheduleRefresh(dir, slow, NOW);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("refreshCache", () => {
  it("stores the latest version", async () => {
    const dir = await tempDir();
    await refreshCache(dir, async () => "3.1.4", NOW);
    expect(JSON.parse(await readFile(join(dir, "latest.json"), "utf8"))).toEqual({
      latest: "3.1.4",
      checkedAt: NOW,
    });
  });

  it("fails silently offline and keeps the previous cache", async () => {
    const dir = await tempDir();
    const cache = { latest: "1.0.0", checkedAt: NOW };
    await writeCacheFile(dir, cache);

    await expect(
      refreshCache(dir, async () => {
        throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
      }),
    ).resolves.toBeUndefined();
    expect(readCache(dir)).toEqual(cache);
  });
});
