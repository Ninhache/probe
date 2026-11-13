import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  PACKAGE_NAME,
  REFRESH_COMMAND,
  REGISTRY_LATEST_URL,
  REGISTRY_TIMEOUT_MS,
  UPDATE_CACHE_FILE,
  UPDATE_CHECK_TTL_MS,
} from "../constants";

export interface UpdateCache {
  latest: string | null;
  checkedAt: number;
}

export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "probe");
}

export function updateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROBE_NO_UPDATE_CHECK === "1" || Boolean(env.CI);
}

export function readCache(dir: string): UpdateCache | null {
  try {
    const cache = JSON.parse(readFileSync(join(dir, UPDATE_CACHE_FILE), "utf8")) as UpdateCache;
    return typeof cache.checkedAt === "number" ? cache : null;
  } catch {
    return null;
  }
}

function writeCache(dir: string, cache: UpdateCache): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, UPDATE_CACHE_FILE), JSON.stringify(cache));
}

export function isNewer(latest: string, current: string): boolean {
  const parse = (version: string) => (version.split("-")[0] ?? "").split(".").map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function updateNotice(current: string, dir: string): string | null {
  const latest = readCache(dir)?.latest;
  if (!latest || !isNewer(latest, current)) return null;
  return `probe ${latest} available (you have ${current}) → \`brew upgrade probe\` or \`npm i -g ${PACKAGE_NAME}\``;
}

/**
 * Starts a detached process that refreshes the cache, at most once per TTL.
 * Never throws and never waits: the notice shows up on a later run.
 */
export function scheduleRefresh(dir: string, cliPath: string, now: number = Date.now()): boolean {
  try {
    const cache = readCache(dir);
    if (cache && now - cache.checkedAt < UPDATE_CHECK_TTL_MS) return false;
    // Stamp first: if the refresh fails (offline), the next try is still a TTL away.
    writeCache(dir, { latest: cache?.latest ?? null, checkedAt: now });
    spawn(process.execPath, [cliPath, REFRESH_COMMAND], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch {
    return false;
  }
}

async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(REGISTRY_LATEST_URL, {
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`registry answered ${response.status}`);
  const { version } = (await response.json()) as { version?: unknown };
  if (typeof version !== "string") throw new Error("registry answer has no version");
  return version;
}

export async function refreshCache(
  dir: string,
  fetchLatest: () => Promise<string> = fetchLatestVersion,
  now: number = Date.now(),
): Promise<void> {
  try {
    writeCache(dir, { latest: await fetchLatest(), checkedAt: now });
  } catch {
    // offline or registry down: keep the previous cache
  }
}
