import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILE, LOCAL_FILE, LOCK_FILE, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";

export interface ProbePaths {
  root: string;
  dir: string;
  config: string;
  lock: string;
  local: string;
}

export function pathsFor(root: string): ProbePaths {
  const dir = join(root, PROBE_DIR);
  return {
    root,
    dir,
    config: join(dir, CONFIG_FILE),
    lock: join(dir, LOCK_FILE),
    local: join(dir, LOCAL_FILE),
  };
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

export function findProbeDir(startDir: string): ProbePaths | null {
  let current = resolve(startDir);
  while (true) {
    if (isDirectory(join(current, PROBE_DIR))) return pathsFor(current);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function requireProbeDir(startDir: string): ProbePaths {
  const paths = findProbeDir(startDir);
  if (!paths) {
    throw new ProbeError(
      "NO_PROBE_DIR",
      `no ${PROBE_DIR}/ found in ${resolve(startDir)} or any parent directory. Run \`probe init\` at the repo root.`,
    );
  }
  return paths;
}
