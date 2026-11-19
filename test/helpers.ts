import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { type ProbePaths, pathsFor } from "../src/config/discovery";

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "probe-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function tempProject(configYaml: string): Promise<ProbePaths> {
  const paths = pathsFor(await tempDir());
  await mkdir(paths.dir);
  await writeFile(paths.config, configYaml);
  return paths;
}

/** Asserts the POSIX permission bits of a file; Windows has no such modes, and reports 0o666 for every file. */
export async function expectMode(path: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  expect((await stat(path)).mode & 0o777).toBe(mode);
}
