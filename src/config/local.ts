import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Document, isMap, isScalar, parseDocument } from "yaml";
import {
  DASHBOARD_INTERVAL_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
  LOCAL_DRAFT_FILE,
  LOCAL_FILE_MODE,
  LOCAL_VARIABLES_KEY,
  MAX_TIMEOUT_SECONDS,
} from "../constants";
import type { DashboardSettings } from "../dashboard/settings";
import type { ProbePaths } from "./discovery";
import type { VariableLookup } from "./headers";

export interface DashboardPreferences {
  interval?: number;
  timeout?: number;
  notify?: boolean;
}

const SECTION = "dashboard";
const KEYS = ["interval", "timeout"] as const;
const NOTIFY = "notify";
const SERVICES = "services";
const SKIP = "skip";

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
  if (doc.getIn([SECTION, NOTIFY]) === true) preferences.notify = true;
  return preferences;
}

export function initialDashboardSettings(
  askedIntervalMs: number | undefined,
  saved: DashboardPreferences,
): DashboardSettings {
  return {
    intervalMs: askedIntervalMs ?? (saved.interval ?? DASHBOARD_INTERVAL_SECONDS) * 1000,
    timeoutMs: (saved.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
    ...(saved.notify ? { notify: true } : {}),
  };
}

// Only what differs from `previous`: an interval given by `--interval` and left alone is never written.
export function changedPreferences(
  previous: DashboardSettings,
  next: DashboardSettings,
): DashboardPreferences {
  const changed: DashboardPreferences = {};
  if (next.intervalMs !== previous.intervalMs) changed.interval = next.intervalMs / 1000;
  if (next.timeoutMs !== previous.timeoutMs) changed.timeout = next.timeoutMs / 1000;
  if (Boolean(next.notify) !== Boolean(previous.notify)) changed.notify = Boolean(next.notify);
  return changed;
}

/** Edits the parsed `local.yml`: true to write it, null when nothing changed, false when unsafe. */
type LocalEdit = (doc: Document) => boolean | null;

// Keeps the permissions of the file and the target of a symlink. False: it cannot be edited safely, nothing is written.
async function editLocal(paths: ProbePaths, edit: LocalEdit): Promise<boolean> {
  const doc = parseDocument((await readLocal(paths)) ?? "");
  if (doc.errors.length > 0) return false;
  if (doc.contents !== null && !isMap(doc.contents)) return false;
  const outcome = edit(doc);
  if (outcome !== true) return outcome === null;
  // A map emptied by the edit would be written as `{}`: an empty file says the same.
  const { contents } = doc;
  const empty = isMap(contents) && contents.items.length === 0 && !contents.comment;
  const text = empty && !doc.comment && !doc.commentBefore ? "" : doc.toString();
  const target = await realpath(paths.local).catch(() => paths.local);
  const existing = await stat(target).catch(() => null);
  const kept = existing ? existing.mode & 0o777 : LOCAL_FILE_MODE;
  // A file that holds variables holds secrets: nobody else reads it, whatever it allowed before.
  const mode = doc.has(LOCAL_VARIABLES_KEY) ? kept & LOCAL_FILE_MODE : kept;
  // Written beside then renamed: a crash never leaves a half-written local.yml.
  const draft = join(dirname(target), LOCAL_DRAFT_FILE);
  try {
    await writeFile(draft, text, { mode });
    // `mode` above is cut by the umask, and ignored when a stale draft already exists.
    await chmod(draft, mode);
    await rename(draft, target);
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
  return true;
}

// Notifications turned off leave no key: off is the default.
export function writeDashboardPreferences(
  paths: ProbePaths,
  preferences: DashboardPreferences,
): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const section = doc.get(SECTION, true);
    if (section !== undefined && !isMap(section)) return false;
    for (const key of KEYS) {
      if (preferences[key] !== undefined) doc.setIn([SECTION, key], preferences[key]);
    }
    if (preferences.notify) doc.setIn([SECTION, NOTIFY], true);
    else if (preferences.notify === false && isMap(section)) {
      section.delete(NOTIFY);
      if (section.items.length === 0) doc.delete(SECTION);
    }
    return true;
  });
}

export async function readSkippedServices(paths: ProbePaths): Promise<Set<string>> {
  if (paths.environment !== undefined) return new Set();
  const text = await readLocal(paths);
  if (text === null) return new Set();
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return new Set();
  const services = doc.get(SERVICES, true);
  if (!isMap(services)) return new Set();
  const names = services.items
    .filter((pair) => isMap(pair.value) && pair.value.get(SKIP) === true)
    .map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key));
  return new Set(names);
}

export function writeServiceSkip(paths: ProbePaths, name: string, skip: boolean): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const services = doc.get(SERVICES, true);
    if (services !== undefined && !isMap(services)) return false;
    const entry = services?.get(name, true);
    if (entry !== undefined && !isMap(entry)) return false;
    if (skip) {
      if (entry?.get(SKIP) === true) return null;
      doc.setIn([SERVICES, name, SKIP], true);
      return true;
    }
    if (!services || !entry?.has(SKIP)) return null;
    entry.delete(SKIP);
    if (entry.items.length === 0) services.delete(name);
    if (services.items.length === 0) doc.delete(SERVICES);
    return true;
  });
}

export interface Variables {
  lookup: VariableLookup;
  /** `local.yml` is there but cannot be read: a variable it may hold is not simply "not set". */
  localUnreadable?: true;
  exportedOnly?: true;
}

export type VariableSource = "environment" | "local";

export async function readLocalVariables(
  paths: ProbePaths,
): Promise<{ values: Record<string, string>; unreadable: boolean }> {
  const text = await readLocal(paths);
  if (text === null) return { values: {}, unreadable: false };
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { values: {}, unreadable: true };
  const section = doc.get(LOCAL_VARIABLES_KEY, true);
  if (!isMap(section)) return { values: {}, unreadable: false };
  const values: Record<string, string> = {};
  for (const { key, value } of section.items) {
    if (!isScalar(key) || !isScalar(value) || value.value === null) continue;
    values[String(key.value)] = String(value.value);
  }
  return { values, unreadable: false };
}

export function variableSource(
  name: string,
  local: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv,
): VariableSource | undefined {
  if (env[name]) return "environment";
  return local[name] ? "local" : undefined;
}

export async function loadVariables(
  paths: ProbePaths,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Variables> {
  // The values of local.yml are those of the local environment: no other one is sent them.
  if (paths.environment !== undefined) {
    return { lookup: (name) => env[name] || undefined, exportedOnly: true };
  }
  const { values, unreadable } = await readLocalVariables(paths);
  return {
    lookup: (name) => env[name] || values[name] || undefined,
    ...(unreadable ? { localUnreadable: true as const } : {}),
  };
}

export function writeVariable(
  paths: ProbePaths,
  name: string,
  value: string | undefined,
): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const section = doc.get(LOCAL_VARIABLES_KEY, true);
    if (section !== undefined && !isMap(section)) return false;
    if (value !== undefined) {
      doc.setIn([LOCAL_VARIABLES_KEY, name], value);
      return true;
    }
    if (!section?.has(name)) return null;
    section.delete(name);
    if (section.items.length === 0) doc.delete(LOCAL_VARIABLES_KEY);
    return true;
  });
}
