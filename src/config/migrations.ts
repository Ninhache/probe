import type { z } from "zod";
import { ProbeError } from "../errors";
import { CURRENT_SCHEMA_VERSION, type SchemaTable, schemas as shippedSchemas } from "./schema";

export type RawConfig = Record<string, unknown>;

/** Converts a config from version n to n + 1. Must be pure; the runner sets `schemaVersion`. */
export type Migration = (config: RawConfig) => RawConfig;

export type MigrationRegistry = Record<number, Migration>;

export const migrations: MigrationRegistry = {};

export interface MigrationPlan {
  from: number;
  to: number;
  steps: number[];
}

export interface MigrationOptions {
  registry?: MigrationRegistry;
  schemas?: SchemaTable;
  target?: number;
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

export function readSchemaVersion(raw: unknown): number {
  const version = (raw as RawConfig | null)?.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProbeError(
      "CONFIG_INVALID",
      `config has no valid \`schemaVersion\` (found: ${JSON.stringify(version)}). Expected a positive integer.`,
    );
  }
  return version;
}

export function planMigration(
  from: number,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrationPlan | null {
  if (from > target) {
    throw new ProbeError(
      "CONFIG_TOO_NEW",
      `config uses schema v${from}, but this probe only knows up to v${target}. It was created by a newer version: upgrade probe.`,
    );
  }
  if (from === target) return null;
  const steps = Array.from({ length: target - from }, (_, index) => from + index);
  return { from, to: target, steps };
}

export function runMigrations(
  raw: RawConfig,
  options: MigrationOptions = {},
): { config: RawConfig; plan: MigrationPlan | null } {
  const registry = options.registry ?? migrations;
  const schemas = options.schemas ?? shippedSchemas;
  const plan = planMigration(readSchemaVersion(raw), options.target);
  if (!plan) return { config: raw, plan };

  const source = schemas[plan.from]?.safeParse(raw);
  if (source && !source.success) {
    throw new ProbeError(
      "CONFIG_INVALID",
      `config is not a valid schema v${plan.from}, cannot migrate it:\n${formatIssues(source.error)}`,
    );
  }

  let config = raw;
  for (const step of plan.steps) {
    const migrate = registry[step];
    if (!migrate) {
      throw new ProbeError(
        "MIGRATION_MISSING",
        `no migration from schema v${step} to v${step + 1}. This is a bug in probe.`,
      );
    }
    config = { ...migrate(structuredClone(config)), schemaVersion: step + 1 };
  }
  return { config, plan };
}
