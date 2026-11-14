import { readFile, rename, writeFile } from "node:fs/promises";
import { isMap, parseDocument } from "yaml";
import { MAX_TIMEOUT_SECONDS } from "../constants";
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
 * Saves the given dashboard settings in `local.yml`, leaving every other key and comment as is.
 * Returns false, writing nothing, when the file exists but cannot be edited safely
 * (invalid YAML, or a top level or a `dashboard` key that is not a map).
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
  // Written beside then renamed: a crash never leaves a half-written local.yml.
  const draft = `${paths.local}.tmp`;
  await writeFile(draft, doc.toString());
  await rename(draft, paths.local);
  return true;
}
