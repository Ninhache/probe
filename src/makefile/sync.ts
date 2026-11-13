import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProbePaths } from "../config/discovery";
import { readLock, writeLock } from "../config/lock";
import type { Config } from "../config/schema";
import { DEFAULT_MAKEFILE } from "../constants";
import { CLI_VERSION } from "../version";
import { extractBlock, hashBlock, renderBlock, replaceBlock } from "./generator";

export type BlockState = "in-sync" | "modified" | "outdated" | "missing";

export interface SyncResult {
  created: boolean;
  changed: boolean;
  hash: string;
}

export function makefilePath(paths: ProbePaths): string {
  return join(paths.root, DEFAULT_MAKEFILE);
}

async function readMakefile(paths: ProbePaths): Promise<string | null> {
  try {
    return await readFile(makefilePath(paths), "utf8");
  } catch (error) {
    // Any other error (EACCES, EISDIR) must not look like "no Makefile": sync would overwrite it.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function syncMakefile(
  paths: ProbePaths,
  config: Config,
  cliVersion: string = CLI_VERSION,
): Promise<SyncResult> {
  const block = renderBlock(Object.keys(config.services));
  const hash = hashBlock(block);
  const current = await readMakefile(paths);
  const next = replaceBlock(current, block);
  const changed = next !== current;
  if (changed) await writeFile(makefilePath(paths), next);

  // Rewriting the lock only when the block changes keeps `cliVersion` from
  // flip-flopping in git between teammates on different probe versions.
  if ((await readLock(paths))?.makefile.hash !== hash) {
    await writeLock(paths, { cliVersion, makefile: { hash } });
  }
  return { created: current === null, changed, hash };
}

export async function blockState(paths: ProbePaths, config: Config): Promise<BlockState> {
  const makefile = await readMakefile(paths);
  const block = makefile === null ? null : extractBlock(makefile);
  if (block === null) return "missing";
  if (block === renderBlock(Object.keys(config.services))) return "in-sync";
  const lock = await readLock(paths);
  return lock?.makefile.hash === hashBlock(block) ? "outdated" : "modified";
}
