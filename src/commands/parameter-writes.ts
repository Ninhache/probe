import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import type { ProbePaths } from "../config/discovery";
import { loadConfig, saveConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
import { type Config, configSchemaV1, type Parameter } from "../config/schema";

export type ParameterWrite =
  | { kind: "add"; name: string; parameter: Parameter }
  | { kind: "edit"; name: string; parameter: Parameter }
  | { kind: "remove"; name: string };

export type ParameterField = "name" | "values" | "strategy" | "strategyName";

export interface ParameterProblem {
  field: ParameterField;
  message: string;
}

export type ParameterWritten =
  | { config: Config; problem?: undefined }
  | { config?: undefined; problem: ParameterProblem };

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The schema stays the judge: what it refuses never reaches the file, said in the words of the form.
function issueProblem({ path, message }: z.core.$ZodIssue, raw: RawConfig): ParameterProblem {
  const [section, name, key, inner] = path.map(String);
  if (section === "services" && key === "urls") {
    const kept = (raw.parameters ?? {}) as Record<string, Parameter>;
    const field = Object.values(kept).some(({ strategy }) => strategy.kind === "url")
      ? "values"
      : "strategy";
    return { field, message: `${name} has an address for ${inner} under urls: change it first` };
  }
  const field: ParameterField =
    key === "values"
      ? "values"
      : key !== "strategy"
        ? "name"
        : inner === "name"
          ? "strategyName"
          : "strategy";
  return { field, message: capitalized(message) };
}

// Only the keys that changed are written: `values: [1, 2]` stays as written when the edit keeps it.
function edited(previous: RawConfig, parameter: Parameter, current?: Parameter): RawConfig {
  const next = { ...previous };
  if (!isDeepStrictEqual(parameter.values, current?.values)) next.values = parameter.values;
  if (!isDeepStrictEqual(parameter.strategy, current?.strategy)) next.strategy = parameter.strategy;
  return next;
}

/** Adds, edits or removes a parameter of `config.yml`, comments kept; null when the name is taken or gone. */
export async function writeParameter(
  paths: ProbePaths,
  write: ParameterWrite,
): Promise<ParameterWritten | null> {
  const loaded = await loadConfig(paths);
  const parameters = (loaded.raw.parameters ?? {}) as Record<string, RawConfig>;
  if (Object.hasOwn(parameters, write.name) === (write.kind === "add")) return null;
  const { [write.name]: previous, ...others } = parameters;
  const next =
    write.kind === "remove"
      ? others
      : {
          ...parameters,
          [write.name]: edited(
            previous ?? {},
            write.parameter,
            loaded.config.parameters?.[write.name],
          ),
        };
  const { parameters: _, ...rest } = loaded.raw;
  const raw = Object.keys(next).length > 0 ? { ...rest, parameters: next } : rest;
  const checked = configSchemaV1.safeParse(raw);
  const issue = checked.success ? undefined : checked.error.issues[0];
  if (issue) return { problem: issueProblem(issue, raw) };
  const saved = await saveConfig(loaded, raw);
  return { config: saved.config };
}
