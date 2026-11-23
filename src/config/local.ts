import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Document, isMap, isScalar, parseDocument, type YAMLMap } from "yaml";
import {
  DASHBOARD_INTERVAL_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
  LOCAL_DRAFT_FILE,
  LOCAL_ENVIRONMENTS_KEY,
  LOCAL_FILE_MODE,
  LOCAL_VARIABLES_KEY,
  MAX_TIMEOUT_SECONDS,
} from "../constants";
import type { DashboardSettings } from "../dashboard/settings";
import type { ProbePaths } from "./discovery";
import type { VariableLookup } from "./headers";
import { EXTRA_SERVICES, NO_OVERRIDES, type ServiceOverrides, withOverrides } from "./overrides";
import type { Selection } from "./parameters";
import type { Config } from "./schema";

export interface DashboardPreferences {
  interval?: number;
  timeout?: number;
  notify?: boolean;
}

const SECTION = "dashboard";
const KEYS = ["interval", "timeout"] as const;
const NOTIFY = "notify";
const PARAMETERS = "parameters";
const SERVICES = "services";
const SKIP = "skip";

function isDelay(value: unknown): value is number {
  return typeof value === "number" && value > 0 && value <= MAX_TIMEOUT_SECONDS;
}

// What local.yml keeps for another environment sits under `envs.<name>`, shaped like the top level.
function scope(paths: ProbePaths): string[] {
  return paths.environment === undefined ? [] : [LOCAL_ENVIRONMENTS_KEY, paths.environment];
}

// A key left without a value (`envs:`) parses as a null scalar: nothing is there.
const isAbsent = (node: unknown) =>
  node === null || node === undefined || (isScalar(node) && node.value === null);

/** The map at `path`: undefined when nothing is there, null when something else is in the way. */
function mapAt(doc: Document, path: readonly string[]): YAMLMap | undefined | null {
  let node: unknown = doc.contents;
  for (const key of path) {
    if (isAbsent(node)) return undefined;
    if (!isMap(node)) return null;
    node = node.get(key, true);
  }
  if (isAbsent(node)) return undefined;
  return isMap(node) ? node : null;
}

// `setIn` does not write through a null scalar: the empty key goes first.
function clearEmptyKeys(doc: Document, path: readonly string[]): void {
  for (let depth = 1; depth <= path.length; depth++) {
    const at = path.slice(0, depth);
    const node = doc.getIn(at, true);
    if (isScalar(node) && node.value === null) {
      doc.deleteIn(at);
      return;
    }
  }
}

function pruneEmpty(doc: Document, path: readonly string[]): void {
  for (let depth = path.length; depth > 0; depth--) {
    const at = path.slice(0, depth);
    const node = doc.getIn(at, true);
    if (!isMap(node) || node.items.length > 0) return;
    doc.deleteIn(at);
  }
}

function holdsVariables(doc: Document): boolean {
  if (doc.has(LOCAL_VARIABLES_KEY)) return true;
  const environments = doc.get(LOCAL_ENVIRONMENTS_KEY, true);
  return (
    isMap(environments) &&
    environments.items.some(({ value }) => isMap(value) && value.has(LOCAL_VARIABLES_KEY))
  );
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

/** The value of each parameter last chosen in the dashboard; one the config no longer lists is left to it. */
export async function readDashboardSelection(paths: ProbePaths): Promise<Selection> {
  const text = await readLocal(paths);
  if (text === null) return {};
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return {};
  const chosen = doc.getIn([SECTION, PARAMETERS], true);
  if (!isMap(chosen)) return {};
  return Object.fromEntries(
    chosen.items.flatMap(({ key, value }) => {
      const name = isScalar(key) ? key.value : key;
      const picked = isScalar(value) ? value.value : value;
      return typeof name === "string" && ["string", "number"].includes(typeof picked)
        ? [[name, String(picked)]]
        : [];
    }),
  );
}

export function writeDashboardSelection(
  paths: ProbePaths,
  name: string,
  value: string,
): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const section = doc.get(SECTION, true);
    if (section !== undefined && !isMap(section)) return false;
    const chosen = doc.getIn([SECTION, PARAMETERS], true);
    if (chosen !== undefined && !isMap(chosen)) return false;
    if (doc.getIn([SECTION, PARAMETERS, name]) === value) return null;
    doc.setIn([SECTION, PARAMETERS, name], value);
    return true;
  });
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
  const mode = holdsVariables(doc) ? kept & LOCAL_FILE_MODE : kept;
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
  const text = await readLocal(paths);
  if (text === null) return new Set();
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return new Set();
  const services = mapAt(doc, [...scope(paths), SERVICES]);
  if (!services) return new Set();
  const names = services.items
    .filter((pair) => isMap(pair.value) && pair.value.get(SKIP) === true)
    .map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key));
  return new Set(names);
}

const nameOf = (key: unknown) => String(isScalar(key) ? key.value : key);

/** The maps under `path`, each as written: an entry that is not a map is left aside. */
function entriesAt(doc: Document, path: readonly string[]): [string, Record<string, unknown>][] {
  const section = mapAt(doc, path);
  if (!section) return [];
  return section.items.flatMap(({ key, value }) =>
    isMap(value) ? [[nameOf(key), value.toJSON() as Record<string, unknown>]] : [],
  );
}

/**
 * What local.yml says of the services: the values it gives those of config.yml, `skip` aside,
 * the names it skips and the services it adds under `extraServices`. Checked by `withOverrides`.
 * A local.yml that is not valid YAML gives none, as for the other values it holds.
 */
export async function readServiceOverrides(paths: ProbePaths): Promise<ServiceOverrides> {
  const at = [...scope(paths), SERVICES];
  const none = { ...NO_OVERRIDES, at: at.join(".") };
  const text = await readLocal(paths);
  if (text === null) return none;
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return none;
  const services: Record<string, Record<string, unknown>> = {};
  const skipped: string[] = [];
  for (const [name, { [SKIP]: skip, ...values }] of entriesAt(doc, at)) {
    if (skip === true) skipped.push(name);
    if (Object.keys(values).length > 0) services[name] = values;
  }
  const extra = Object.fromEntries(entriesAt(doc, [...scope(paths), EXTRA_SERVICES]));
  return {
    at: none.at,
    services,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/**
 * The services as this machine reaches them: those of config.yml with the values of local.yml.
 * For checks and addresses only: what is written back to config.yml starts from `config`.
 */
export async function localConfig(config: Config, paths: ProbePaths): Promise<Config> {
  return withOverrides(config, await readServiceOverrides(paths));
}

export function writeServiceSkip(paths: ProbePaths, name: string, skip: boolean): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const path = [...scope(paths), SERVICES, name];
    const entry = mapAt(doc, path);
    if (entry === null) return false;
    if (skip) {
      if (entry?.get(SKIP) === true) return null;
      clearEmptyKeys(doc, path);
      doc.setIn([...path, SKIP], true);
      return true;
    }
    if (!entry?.has(SKIP)) return null;
    entry.delete(SKIP);
    pruneEmpty(doc, path);
    return true;
  });
}

/**
 * Takes out what local.yml says of a service removed from config.yml, in the scope of `paths`.
 * The rest of local.yml, comments included, is kept.
 */
export function removeServiceEntry(paths: ProbePaths, name: string): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const path = [...scope(paths), SERVICES, name];
    if (doc.getIn(path, true) === undefined) return null;
    doc.deleteIn(path);
    pruneEmpty(doc, path.slice(0, -1));
    return true;
  });
}

export interface Variables {
  lookup: VariableLookup;
  /** `local.yml` is there but cannot be read: a variable it may hold is not simply "not set". */
  localUnreadable?: true;
  /** Set when the values are those of another environment than the local one. */
  environment?: string;
}

export type VariableSource = "environment" | "local";

export async function readLocalVariables(
  paths: ProbePaths,
): Promise<{ values: Record<string, string>; unreadable: boolean }> {
  const text = await readLocal(paths);
  if (text === null) return { values: {}, unreadable: false };
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { values: {}, unreadable: true };
  const section = mapAt(doc, [...scope(paths), LOCAL_VARIABLES_KEY]);
  if (!section) return { values: {}, unreadable: false };
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
  // Each environment has its own values in local.yml: none falls back on those of another.
  const { values, unreadable } = await readLocalVariables(paths);
  return {
    lookup: (name) => env[name] || values[name] || undefined,
    ...(paths.environment === undefined ? {} : { environment: paths.environment }),
    ...(unreadable ? { localUnreadable: true as const } : {}),
  };
}

export function writeVariable(
  paths: ProbePaths,
  name: string,
  value: string | undefined,
): Promise<boolean> {
  return editLocal(paths, (doc) => {
    const path = [...scope(paths), LOCAL_VARIABLES_KEY];
    const section = mapAt(doc, path);
    if (section === null) return false;
    if (value !== undefined) {
      clearEmptyKeys(doc, path);
      doc.setIn([...path, name], value);
      return true;
    }
    if (!section?.has(name)) return null;
    section.delete(name);
    pruneEmpty(doc, path);
    return true;
  });
}
