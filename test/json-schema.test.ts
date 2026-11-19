import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, schemas } from "../src/config/schema";
import { configJsonSchemaUrl } from "../src/constants";

const ROOT = resolve(import.meta.dirname, "..");

// Input mode: the file describes what a person writes, defaults still optional.
function jsonSchemaOf(version: number) {
  const { $schema, ...rest } = z.toJSONSchema(schemas[version] as z.ZodType, { io: "input" });
  return {
    $schema,
    $id: configJsonSchemaUrl(version),
    title: `probe config.yml, schemaVersion ${version}`,
    ...rest,
  };
}

// zod writes `format: starts_with` next to the pattern that checks it.
const validate = new Ajv2020({ formats: { starts_with: true } }).compile(
  jsonSchemaOf(CURRENT_SCHEMA_VERSION),
);

async function documentedConfigs(): Promise<[string, unknown][]> {
  const docs = join(ROOT, "docs");
  const files = [
    "config.md",
    ...(await readdir(join(docs, "features"))).map((file) => join("features", file)),
  ];
  const found: [string, unknown][] = [];
  for (const file of files) {
    const text = await readFile(join(docs, file), "utf8");
    for (const [index, [, block]] of [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].entries()) {
      const value: unknown = parse(block as string);
      if (typeof value !== "object" || value === null) continue;
      if (!("services" in value) && !("parameters" in value)) continue;
      found.push([`${file} #${index + 1}`, { schemaVersion: CURRENT_SCHEMA_VERSION, ...value }]);
    }
  }
  return found;
}

describe("the JSON Schema of config.yml", () => {
  // `vitest -u` rewrites the files after a schema change.
  it.each(Object.keys(schemas).map(Number))(
    "is generated from the zod schema v%i",
    async (version) => {
      await expect(`${JSON.stringify(jsonSchemaOf(version), null, 2)}\n`).toMatchFileSnapshot(
        `../schema/config.v${version}.json`,
      );
    },
  );

  it("accepts the configs of the repository", async () => {
    for (const file of [
      "examples/demo/.probe/config.yml",
      "test/fixtures/migrations/v1.config.yml",
    ]) {
      const config: unknown = parse(await readFile(join(ROOT, file), "utf8"));
      expect(validate(config), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  // The zod schema checks more than a JSON Schema can say, never less.
  it("accepts every documented config that probe accepts", async () => {
    const configs = await documentedConfigs();
    expect(configs.length).toBeGreaterThan(5);
    for (const [name, config] of configs) {
      if (!schemas[CURRENT_SCHEMA_VERSION]?.safeParse(config).success) continue;
      expect(validate(config), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it("accepts a command service in both forms and refuses an unknown type", () => {
    const services = {
      db: { type: "command", command: ["pg_isready", "-q"], timeout: 5 },
      cache: { type: "command", command: "redis-cli ping" },
    };

    expect(validate({ schemaVersion: 1, services })).toBe(true);
    expect(validate({ schemaVersion: 1, services: { db: { type: "tcp" } } })).toBe(false);
    expect(validate({ schemaVersion: 1, services: { db: { type: "command", command: [] } } })).toBe(
      false,
    );
  });

  it("refuses a misspelled key", () => {
    expect(validate({ schemaVersion: 1, services: { api: { prot: 3000 } } })).toBe(false);
    expect(validate.errors?.[0]).toMatchObject({
      instancePath: "/services/api",
      params: { additionalProperty: "prot" },
    });
  });
});
