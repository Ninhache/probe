import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProbePaths } from "../config/discovery";
import { PROBE_DIR, TRACES_DIR } from "../constants";

/** Keeps the whole folder out of git: a trace may hold what a service answered. */
const TRACES_GITIGNORE = "*\n";
const TRACE_EXTENSION = ".http";
/** Attempts at a free name before giving up: a loop would only hide a folder gone wrong. */
const MAX_SUFFIX = 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-19T12-04-33`, local time, with no colon: a name macOS and Linux both accept. */
export function traceStamp(at: Date): string {
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day}T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
}

const isExists = (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST";

/**
 * Writes a trace to `.probe/traces/<service>-<stamp>.http` and says where, relative to the project.
 * The folder gets its own `.gitignore` the first time and it is never overwritten; a name already taken
 * gets `-2`, `-3`. Never throws: a failure comes back as the notice.
 */
export async function saveTrace(
  paths: ProbePaths,
  service: string,
  text: string,
  now: Date = new Date(),
): Promise<string> {
  const folder = join(paths.dir, TRACES_DIR);
  const shown = `${PROBE_DIR}/${TRACES_DIR}`;
  try {
    await mkdir(folder, { recursive: true });
    // `wx`: a `.gitignore` the user edited is left alone.
    await writeFile(join(folder, ".gitignore"), TRACES_GITIGNORE, { flag: "wx" }).catch((error) => {
      if (!isExists(error)) throw error;
    });
    const base = `${service.replace(/[^A-Za-z0-9._-]/g, "_")}-${traceStamp(now)}`;
    for (let n = 1; n <= MAX_SUFFIX; n += 1) {
      const name = `${base}${n === 1 ? "" : `-${n}`}${TRACE_EXTENSION}`;
      try {
        await writeFile(join(folder, name), text, { flag: "wx" });
        return `Saved ${shown}/${name}`;
      } catch (error) {
        if (!isExists(error)) throw error;
      }
    }
    return `Not saved: no free name in ${shown}`;
  } catch (error) {
    return `Not saved: ${(error as NodeJS.ErrnoException).code ?? "write failed"} in ${shown}`;
  }
}
