import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformFor } from "../src/platform";
import { isOnPath } from "../src/platform/on-path";
import { tempDir } from "./helpers";

/** A filesystem that holds only these paths, so that a Windows lookup runs on any OS. */
const holding =
  (...paths: string[]) =>
  async (path: string) =>
    paths.includes(path);

describe("isOnPath", () => {
  it("should find make.exe on a Windows PATH through PATHEXT", async () => {
    const env = { Path: "C:\\a;C:\\b", PATHEXT: ".COM;.EXE" };
    const found = holding(join("C:\\b", "make.EXE"));

    expect(await isOnPath("make", env, platformFor("win32"), found)).toBe(true);
  });

  it("should not take a bare make for a program on Windows", async () => {
    const env = { Path: "C:\\a", PATHEXT: ".EXE" };

    expect(await isOnPath("make", env, platformFor("win32"), holding(join("C:\\a", "make")))).toBe(
      false,
    );
  });

  it("should say no when the PATH is empty or has no make", async () => {
    expect(await isOnPath("make", {}, platformFor("linux"), holding())).toBe(false);
    expect(
      await isOnPath("make", { PATH: "/a:/b" }, platformFor("linux"), holding("/a/gmake")),
    ).toBe(false);
  });

  it("should find an executable file in a directory of the real PATH", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "make"), "");
    await chmod(join(dir, "make"), 0o755);
    await writeFile(join(dir, "make.exe"), "");

    expect(await isOnPath("make", { PATH: dir, Path: dir })).toBe(true);
  });

  it("should not take a directory named make for a program", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "make"));
    await mkdir(join(dir, "make.exe"));

    expect(await isOnPath("make", { PATH: `${dir}${delimiter}${dir}`, Path: dir })).toBe(false);
  });
});
