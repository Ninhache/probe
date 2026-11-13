import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { type Document, parseDocument } from "yaml";
import { ProbeError } from "../errors";
import type { ProbePaths } from "./discovery";
import {
  formatIssues,
  type MigrationOptions,
  type MigrationPlan,
  planMigration,
  type RawConfig,
  readSchemaVersion,
  runMigrations,
} from "./migrations";
import { type Config, CURRENT_SCHEMA_VERSION, schemas as shippedSchemas } from "./schema";
import { reconcileDocument } from "./yaml-document";

export interface LoadOptions extends MigrationOptions {
  log?: (message: string) => void;
}

export interface LoadedConfig {
  /** Validated config, defaults applied. Read from this. */
  config: Config;
  /** What is in the file, without defaults. Write from this. */
  raw: RawConfig;
  doc: Document;
  paths: ProbePaths;
  migratedFrom: number | null;
}

async function readDocument(paths: ProbePaths): Promise<{ doc: Document; raw: RawConfig }> {
  let text: string;
  try {
    text = await readFile(paths.config, "utf8");
  } catch {
    throw new ProbeError("CONFIG_MISSING", `cannot read ${paths.config}. Run \`probe init\`.`);
  }
  const doc = parseDocument(text);
  const [syntaxError] = doc.errors;
  if (syntaxError) {
    throw new ProbeError(
      "CONFIG_INVALID",
      `${paths.config} is not valid YAML: ${syntaxError.message}`,
    );
  }
  const raw: unknown = doc.toJS();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProbeError("CONFIG_INVALID", `${paths.config} must be a YAML mapping.`);
  }
  return { doc, raw: raw as RawConfig };
}

function validate(raw: RawConfig, paths: ProbePaths, options: MigrationOptions): Config {
  const target = options.target ?? CURRENT_SCHEMA_VERSION;
  const schema = (options.schemas ?? shippedSchemas)[target];
  if (!schema) throw new ProbeError("MIGRATION_MISSING", `no schema for config v${target}.`);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ProbeError(
      "CONFIG_INVALID",
      `${paths.config} is invalid:\n${formatIssues(result.error)}`,
    );
  }
  return result.data as Config;
}

export function backupPath(paths: ProbePaths, version: number): string {
  return join(paths.dir, `config.v${version}.bak.yml`);
}

/** Tells whether loading would migrate, without writing anything. */
export async function pendingMigration(
  paths: ProbePaths,
  options: MigrationOptions = {},
): Promise<MigrationPlan | null> {
  const { raw } = await readDocument(paths);
  return planMigration(readSchemaVersion(raw), options.target);
}

export async function loadConfig(
  paths: ProbePaths,
  options: LoadOptions = {},
): Promise<LoadedConfig> {
  const { doc, raw } = await readDocument(paths);
  const { config: migrated, plan } = runMigrations(raw, options);
  const config = validate(migrated, paths, options);

  if (plan) {
    const backup = backupPath(paths, plan.from);
    await copyFile(paths.config, backup);
    reconcileDocument(doc, migrated);
    await writeFile(paths.config, doc.toString());
    const log = options.log ?? ((message: string) => console.error(message));
    log(
      `probe: migrated ${relative(paths.root, paths.config)} from schema v${plan.from} to v${plan.to} (backup: ${relative(paths.root, backup)})`,
    );
  }

  return { config, raw: migrated, doc, paths, migratedFrom: plan?.from ?? null };
}

/** Validates `raw`, then rewrites config.yml keeping comments. */
export async function saveConfig(
  loaded: LoadedConfig,
  raw: RawConfig,
  options: MigrationOptions = {},
): Promise<LoadedConfig> {
  const config = validate(raw, loaded.paths, options);
  reconcileDocument(loaded.doc, raw);
  await writeFile(loaded.paths.config, loaded.doc.toString());
  return { ...loaded, config, raw };
}
