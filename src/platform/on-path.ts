import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { currentPlatform } from "./index";
import type { Platform } from "./types";

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    // X_OK is only "exists" on Windows, where the extension is what makes a file a program.
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `program` is found in a directory of the PATH. The program is never run: asking it
 * `--version` would start whatever shadows the name. `isProgram` is a parameter for tests.
 */
export async function isOnPath(
  program: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: Platform = currentPlatform,
  isProgram: (path: string) => Promise<boolean> = isExecutableFile,
): Promise<boolean> {
  const names = platform.programNames(program, env);
  for (const directory of platform.pathEntries(env)) {
    for (const name of names) {
      if (await isProgram(join(directory, name))) return true;
    }
  }
  return false;
}
