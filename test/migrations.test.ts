import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { backupPath, loadConfig, pendingMigration } from "../src/config/loader";
import {
  type MigrationOptions,
  type MigrationRegistry,
  planMigration,
  type RawConfig,
  runMigrations,
} from "../src/config/migrations";
import { type SchemaTable, schemas, serviceSchemaV1 } from "../src/config/schema";
import { tempProject } from "./helpers";

const fixture = (name: string) =>
  readFile(join(import.meta.dirname, "fixtures", "migrations", name), "utf8");

// A pretend V2: every service gains `type: http`.
const configSchemaV2 = z.strictObject({
  schemaVersion: z.literal(2),
  services: z.record(z.string(), serviceSchemaV1.extend({ type: z.enum(["http", "tcp"]) })),
});

const addHttpType = (config: RawConfig): RawConfig => ({
  ...config,
  services: Object.fromEntries(
    Object.entries(config.services as Record<string, RawConfig>).map(([name, service]) => [
      name,
      { ...service, type: "http" },
    ]),
  ),
});

const v2: MigrationOptions = {
  registry: { 1: addHttpType } satisfies MigrationRegistry,
  schemas: { ...schemas, 2: configSchemaV2 } satisfies SchemaTable,
  target: 2,
};

describe("planMigration", () => {
  it("returns null when the config is current", () => {
    expect(planMigration(1, 1)).toBeNull();
  });

  it("lists every step of the chain", () => {
    expect(planMigration(1, 4)).toEqual({ from: 1, to: 4, steps: [1, 2, 3] });
  });

  it("refuses a config newer than the CLI", () => {
    expect(() => planMigration(3, 2)).toThrowError(/newer version: upgrade probe/);
  });
});

describe("runMigrations", () => {
  it("chains migrations and bumps schemaVersion itself", () => {
    const { config } = runMigrations(
      { schemaVersion: 1, services: {} },
      {
        registry: { 1: (c) => ({ ...c, a: true }), 2: (c) => ({ ...c, b: true }) },
        schemas: {},
        target: 3,
      },
    );
    expect(config).toEqual({ schemaVersion: 3, services: {}, a: true, b: true });
  });

  it("does not mutate its input", () => {
    const input = { schemaVersion: 1, services: { api: { port: 3000 } } };
    const snapshot = structuredClone(input);
    runMigrations(input, v2);
    expect(input).toEqual(snapshot);
  });

  it("fails when a step has no migration", () => {
    expect(() =>
      runMigrations({ schemaVersion: 1, services: {} }, { registry: {}, target: 2 }),
    ).toThrowError(/no migration from schema v1 to v2/);
  });

  it("rejects an invalid source config before migrating it", () => {
    expect(() => runMigrations({ schemaVersion: 1, services: { api: {} } }, v2)).toThrowError(
      /not a valid schema v1/,
    );
  });
});

describe("loadConfig with a pending v1 -> v2 migration", () => {
  it("rewrites the config, keeps comments and backs up the original", async () => {
    const original = await fixture("v1.config.yml");
    const paths = await tempProject(original);
    const messages: string[] = [];

    const loaded = await loadConfig(paths, { ...v2, log: (m) => messages.push(m) });

    expect(await readFile(paths.config, "utf8")).toBe(await fixture("v2.expected.yml"));
    expect(await readFile(backupPath(paths, 1), "utf8")).toBe(original);
    expect(loaded.migratedFrom).toBe(1);
    expect(loaded.config.services.api).toMatchObject({ port: 3000, type: "http" });
    expect(messages).toEqual([
      "probe: migrated .probe/config.yml from schema v1 to v2 (backup: .probe/config.v1.bak.yml)",
    ]);
  });

  it("does nothing on the second load", async () => {
    const paths = await tempProject(await fixture("v1.config.yml"));
    await loadConfig(paths, { ...v2, log: () => {} });
    const afterFirst = await readFile(paths.config, "utf8");
    const messages: string[] = [];

    const loaded = await loadConfig(paths, { ...v2, log: (m) => messages.push(m) });

    expect(loaded.migratedFrom).toBeNull();
    expect(messages).toEqual([]);
    expect(await readFile(paths.config, "utf8")).toBe(afterFirst);
  });

  it("pendingMigration reports the plan without writing", async () => {
    const original = await fixture("v1.config.yml");
    const paths = await tempProject(original);

    expect(await pendingMigration(paths, v2)).toEqual({ from: 1, to: 2, steps: [1] });
    expect(await readFile(paths.config, "utf8")).toBe(original);
  });

  it("leaves the file alone when the migrated config is invalid", async () => {
    const original = await fixture("v1.config.yml");
    const paths = await tempProject(original);
    const broken: MigrationOptions = { ...v2, registry: { 1: (c) => ({ ...c, oops: 1 }) } };

    await expect(loadConfig(paths, broken)).rejects.toThrowError(/is invalid/);
    expect(await readFile(paths.config, "utf8")).toBe(original);
  });
});
