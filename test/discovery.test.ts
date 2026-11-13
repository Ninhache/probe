import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findProbeDir, requireProbeDir } from "../src/config/discovery";
import { tempDir } from "./helpers";

describe("findProbeDir", () => {
  it("finds .probe/ in the start directory", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".probe"));

    expect(findProbeDir(root)).toMatchObject({
      root,
      dir: join(root, ".probe"),
      config: join(root, ".probe", "config.yml"),
      lock: join(root, ".probe", "lock.yml"),
      local: join(root, ".probe", "local.yml"),
    });
  });

  it("walks up from a nested sub-directory", async () => {
    const root = await tempDir();
    const nested = join(root, "packages", "api", "src");
    await mkdir(join(root, ".probe"));
    await mkdir(nested, { recursive: true });

    expect(findProbeDir(nested)?.root).toBe(root);
  });

  it("picks the closest .probe/ when several are nested", async () => {
    const root = await tempDir();
    const inner = join(root, "apps", "web");
    await mkdir(join(root, ".probe"));
    await mkdir(join(inner, ".probe"), { recursive: true });

    expect(findProbeDir(inner)?.root).toBe(inner);
  });

  it("returns null when no parent has one", async () => {
    expect(findProbeDir(await tempDir())).toBeNull();
  });

  it("requireProbeDir explains how to fix it", async () => {
    const root = await tempDir();
    expect(() => requireProbeDir(root)).toThrowError(/probe init/);
  });
});
