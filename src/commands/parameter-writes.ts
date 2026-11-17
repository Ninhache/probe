import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import type { ProbePaths } from "../config/discovery";
import { loadConfig, saveConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
import { type Config, configSchemaV1, type Parameter } from "../config/schema";

/** Per service, the address typed for a value; an empty one removes it. */
export type AddressChanges = Readonly<Record<string, Readonly<Record<string, string>>>>;

interface ParameterChange {
  name: string;
  parameter: Parameter;
  /** Only with `strategy: { kind: url }`: the addresses of a value no longer listed go too. */
  addresses?: AddressChanges;
  /** The addresses that go were shown and accepted. */
  confirmed?: boolean;
}

export type ParameterWrite =
  | ({ kind: "add" } & ParameterChange)
  | ({ kind: "edit" } & ParameterChange)
  | { kind: "remove"; name: string };

export type ParameterField = "name" | "values" | "strategy" | "strategyName" | "address";

export interface ParameterProblem {
  field: ParameterField;
  message: string;
  address?: { service: string; value: string };
}

export type ParameterWritten =
  | { config: Config; problem?: undefined; drops?: undefined }
  | { config?: undefined; problem: ParameterProblem; drops?: undefined }
  /** Nothing written: these addresses (`api dev`) would go, and were not confirmed. */
  | { config?: undefined; problem?: undefined; drops: string[] };

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The schema stays the judge: what it refuses never reaches the file, said in the words of the form.
function issueProblem({ path, message }: z.core.$ZodIssue, raw: RawConfig): ParameterProblem {
  const [section, name, key, inner] = path.map(String);
  if (section === "services" && key === "urls" && name !== undefined && inner !== undefined) {
    const kept = (raw.parameters ?? {}) as Record<string, Parameter>;
    const url = Object.values(kept).find(({ strategy }) => strategy.kind === "url");
    // The message of the schema never repeats the address: it may hold a user and a password.
    if (url?.values.map(String).includes(inner))
      return {
        field: "address",
        message: capitalized(message),
        address: { service: name, value: inner },
      };
    const field = url ? "values" : "strategy";
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

// The file is the reference, not the form: an address added by hand since is counted and kept.
function addressedServices(
  raw: RawConfig,
  { parameter, addresses = {} }: ParameterChange,
): { services: Record<string, RawConfig>; drops: string[] } {
  const services = { ...((raw.services ?? {}) as Record<string, RawConfig>) };
  const listed = new Set(parameter.values.map(String));
  const drops: string[] = [];
  for (const [name, service] of Object.entries(services)) {
    const before = (service.urls ?? {}) as Record<string, string>;
    const urls = { ...before };
    for (const value of Object.keys(before)) {
      if (listed.has(value)) continue;
      drops.push(`${name} ${value}`);
      delete urls[value];
    }
    for (const [value, address] of Object.entries(addresses[name] ?? {})) {
      if (!listed.has(value)) continue;
      if (address === "") delete urls[value];
      else urls[value] = address;
    }
    if (isDeepStrictEqual(urls, before)) continue;
    const { urls: _, ...rest } = service;
    services[name] = Object.keys(urls).length > 0 ? { ...rest, urls } : rest;
  }
  return { services, drops };
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
  const kept = Object.keys(next).length > 0 ? { ...rest, parameters: next } : rest;
  const addressed =
    write.kind !== "remove" && write.addresses && write.parameter.strategy.kind === "url"
      ? addressedServices(kept, write)
      : undefined;
  if (addressed && addressed.drops.length > 0 && !(write.kind !== "remove" && write.confirmed))
    return { drops: addressed.drops };
  const raw = addressed ? { ...kept, services: addressed.services } : kept;
  const checked = configSchemaV1.safeParse(raw);
  const issue = checked.success ? undefined : checked.error.issues[0];
  if (issue) return { problem: issueProblem(issue, raw) };
  const saved = await saveConfig(loaded, raw);
  return { config: saved.config };
}
