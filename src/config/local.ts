import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMap, parseDocument } from "yaml";
import {
  DASHBOARD_INTERVAL_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
  LOCAL_DRAFT_FILE,
  LOCAL_FILE_MODE,
  MAX_TIMEOUT_SECONDS,
} from "../constants";
import type { DashboardSettings } from "../dashboard/settings";
import type { ProbePaths } from "./discovery";

/** Dashboard settings kept in `local.yml` under `dashboard`, in seconds. */
export interface DashboardPreferences {
  interval?: number;
  timeout?: number;
}

const SECTION = "dashboard";
const KEYS = ["interval", "timeout"] as const;

function isDelay(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value <= MAX_TIMEOUT_SECONDS;
}

async function readLocal(paths: ProbePaths): Promise<string | null> {
  try {
    return await readFile(paths.local, "utf8");
  } catch {
    return null;
  }
}

/**
 * Reads the dashboard settings saved in `local.yml`.
 * A missing or unreadable file gives no setting; a key that is not a usable delay is left out.
 */
export async function readDashboardPreferences(paths: ProbePaths): Promise<DashboardPreferences> {
  const text = await readLocal(paths);
  if (text === null) return {};
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return {};
  const preferences: DashboardPreferences = {};
  for (const key of KEYS) {
    const value = doc.getIn([SECTION, key]);
    if (isDelay(value)) preferences[key] = value;
  }
  return preferences;
}

/**
 * Settings the dashboard starts with: `--interval` (`askedIntervalMs`) first, then what
 * `local.yml` holds, then the defaults.
 */
export function initialDashboardSettings(
  askedIntervalMs: number | undefined,
  saved: DashboardPreferences,
): DashboardSettings {
  return {
    intervalMs: askedIntervalMs ?? (saved.interval ?? DASHBOARD_INTERVAL_SECONDS) * 1000,
    timeoutMs: (saved.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
  };
}

/**
 * What to save after a change in the options panel: only the settings that differ from `previous`,
 * so an interval given by `--interval` and left alone is never written.
 */
export function changedPreferences(
  previous: DashboardSettings,
  next: DashboardSettings,
): DashboardPreferences {
  const changed: DashboardPreferences = {};
  if (next.intervalMs !== previous.intervalMs) changed.interval = next.intervalMs / 1000;
  if (next.timeoutMs !== previous.timeoutMs) changed.timeout = next.timeoutMs / 1000;
  return changed;
}

/**
 * Saves the given dashboard settings in `local.yml`, leaving every other key and comment as is.
 * The file keeps its permissions (a new one is owner-only) and, when it is a symlink, its target
 * is the file replaced. Returns false, writing nothing, when the file exists but cannot be edited
 * safely (invalid YAML, or a top level or a `dashboard` key that is not a map).
 * Throws when the file cannot be written; no copy of it is left behind.
 */
export async function writeDashboardPreferences(
  paths: ProbePaths,
  preferences: DashboardPreferences,
): Promise<boolean> {
  const doc = parseDocument((await readLocal(paths)) ?? "");
  if (doc.errors.length > 0) return false;
  if (doc.contents !== null && !isMap(doc.contents)) return false;
  const section = doc.get(SECTION, true);
  if (section !== undefined && !isMap(section)) return false;
  for (const key of KEYS) {
    if (preferences[key] !== undefined) doc.setIn([SECTION, key], preferences[key]);
  }
  const target = await realpath(paths.local).catch(() => paths.local);
  const existing = await stat(target).catch(() => null);
  const mode = existing ? existing.mode & 0o777 : LOCAL_FILE_MODE;
  // Written beside then renamed: a crash never leaves a half-written local.yml.
  const draft = join(dirname(target), LOCAL_DRAFT_FILE);
  try {
    await writeFile(draft, doc.toString(), { mode });
    // `mode` above is cut by the umask, and ignored when a stale draft already exists.
    await chmod(draft, mode);
    await rename(draft, target);
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
  return true;
}
