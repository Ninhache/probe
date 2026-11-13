import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1;

export const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const statusCode = z.number().int().min(100).max(599);

export const serviceSchemaV1 = z.strictObject({
  host: z.string().min(1).default("localhost"),
  port: z.number().int().min(1).max(65535),
  path: z.string().startsWith("/").default("/"),
  expect: z.union([statusCode, z.array(statusCode).min(1)]).optional(),
});

export const configSchemaV1 = z.strictObject({
  schemaVersion: z.literal(1),
  services: z
    .record(
      z.string().regex(SERVICE_NAME_PATTERN, "letters, digits, _ and - only"),
      serviceSchemaV1,
    )
    // `services:` with nothing under it parses as null.
    .nullish()
    .transform((services) => services ?? {}),
});

export type Config = z.infer<typeof configSchemaV1>;
export type Service = Config["services"][string];

export type SchemaTable = Record<number, z.ZodType>;

export const schemas: SchemaTable = {
  1: configSchemaV1,
};
