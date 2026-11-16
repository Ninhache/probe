import type { z } from "zod";
import { HINT_EXPECTED, METHODS, SERVICE_NAME_PATTERN, serviceShapeV1 } from "./schema";

const INTEGER = /^\d+$/;

function schemaProblem(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

export function parseExpectList(value: string): number | number[] {
  const codes = value.split(",").map((code) => Number(code.trim()));
  return codes.length === 1 ? (codes[0] as number) : codes;
}

export function nameProblem(name: string, taken: Iterable<string>): string | undefined {
  if (!SERVICE_NAME_PATTERN.test(name)) return "Letters, digits, _ and - only, e.g. api";
  if ([...taken].includes(name)) return `${name} already exists`;
  return undefined;
}

export function portProblem(port: string): string | undefined {
  if (!INTEGER.test(port)) return "A port number, e.g. 3000";
  return schemaProblem(serviceShapeV1.port, Number(port)) && "A port between 1 and 65535";
}

export function hostProblem(host: string): string | undefined {
  return /\s|\//.test(host) || host === "" ? "A host name or an IP, e.g. localhost" : undefined;
}

export function pathProblem(path: string): string | undefined {
  return schemaProblem(serviceShapeV1.path, path) && "A path that starts with /";
}

export function methodProblem(method: string): string | undefined {
  return schemaProblem(serviceShapeV1.method, method) && `One of ${METHODS.join(", ")}`;
}

export function hintProblem(hint: string): string | undefined {
  return schemaProblem(serviceShapeV1.hint, hint) && HINT_EXPECTED;
}

export function expectProblem(expect: string): string | undefined {
  const codes = expect.split(",").map((code) => code.trim());
  if (!codes.every((code) => INTEGER.test(code))) return "A status, or several: 200 or 200,204";
  return (
    schemaProblem(serviceShapeV1.expect, parseExpectList(expect)) && "Statuses go from 100 to 599"
  );
}
