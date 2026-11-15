import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
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
