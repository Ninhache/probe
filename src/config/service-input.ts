import type { z } from "zod";
import { SERVICE_NAME_PATTERN, serviceSchemaV1 } from "./schema";

const INTEGER = /^\d+$/;

/** What the config schema finds wrong with a value, in one line; undefined when it accepts it. */
function schemaProblem(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** Reads `200` or `200,204` as typed; the caller checks it first with `expectProblem`. */
export function parseExpectList(value: string): number | number[] {
  const codes = value.split(",").map((code) => Number(code.trim()));
  return codes.length === 1 ? (codes[0] as number) : codes;
}

/** Each of these says in one line why a typed value is refused; undefined when it is accepted. */
export function nameProblem(name: string, taken: Iterable<string>): string | undefined {
  if (!SERVICE_NAME_PATTERN.test(name)) return "Letters, digits, _ and - only, e.g. api";
  if ([...taken].includes(name)) return `${name} already exists`;
  return undefined;
}

export function portProblem(port: string): string | undefined {
  if (!INTEGER.test(port)) return "A port number, e.g. 3000";
  return schemaProblem(serviceSchemaV1.shape.port, Number(port)) && "A port between 1 and 65535";
}

export function hostProblem(host: string): string | undefined {
  return /\s|\//.test(host) || host === "" ? "A host name or an IP, e.g. localhost" : undefined;
}

export function pathProblem(path: string): string | undefined {
  return schemaProblem(serviceSchemaV1.shape.path, path) && "A path that starts with /";
}

export function expectProblem(expect: string): string | undefined {
  const codes = expect.split(",").map((code) => code.trim());
  if (!codes.every((code) => INTEGER.test(code))) return "A status, or several: 200 or 200,204";
  return (
    schemaProblem(serviceSchemaV1.shape.expect, parseExpectList(expect)) &&
    "Statuses go from 100 to 599"
  );
}
