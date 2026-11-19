import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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

const PATH_SHIMS = ["make", "make.exe", "make.cmd"];
let shimDirs: { present: string; absent: string } | undefined;

/** One directory with a `make` that is never run (a file is all a PATH lookup asks for), and one without. */
function makeDirs(): { present: string; absent: string } {
  if (shimDirs) return shimDirs;
  const root = mkdtempSync(join(tmpdir(), "probe-make-"));
  const present = join(root, "with");
  const absent = join(root, "without");
  mkdirSync(present);
  mkdirSync(absent);
  for (const name of PATH_SHIMS) {
    writeFileSync(join(present, name), "");
    chmodSync(join(present, name), 0o755);
  }
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
  shimDirs = { present, absent };
  return shimDirs;
}

/**
 * The PATH a spawned probe gets so that `make` is found or not, whatever the machine has installed.
 * The variable keeps the spelling of the environment (`Path` on Windows): a second spelling would
 * leave the child with two.
 */
export function makeEnv(installed: boolean): NodeJS.ProcessEnv {
  const key = Object.keys(process.env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  const dirs = makeDirs();
  return {
    [key]: installed ? `${dirs.present}${delimiter}${process.env[key] ?? ""}` : dirs.absent,
    PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
  };
}

/** What a spawned probe inherits: the variables a process needs to run, not the whole environment of the test run. */
const INHERITED = [
  "PATH",
  "PATHEXT",
  "HOME",
  "XDG_CACHE_HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
];

export function inheritedEnv(): NodeJS.ProcessEnv {
  const wanted = new Set(INHERITED);
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => wanted.has(name.toUpperCase())),
  );
}
