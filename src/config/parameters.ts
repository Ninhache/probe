import { serviceType } from "../checkers/registry";
import type { ServiceTypes } from "../checkers/types";
import { ProbeError } from "../errors";
import type { Config, Parameter } from "./schema";

export type Selection = Readonly<Record<string, string>>;

const SET_EXAMPLE = "--set tenant=globex";

const listed = (names: readonly string[]) => names.join(", ") || "(none)";

/** The values asked for as `name=value`: each must be one the config lists. */
export function selectionFrom(config: Config, pairs: readonly string[]): Selection {
  const parameters = config.parameters ?? {};
  const selection: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0 || at === pair.length - 1) {
      throw new ProbeError("USAGE", `--set expects name=value, e.g. ${SET_EXAMPLE}.`);
    }
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    const parameter = Object.hasOwn(parameters, name) ? parameters[name] : undefined;
    if (!parameter) {
      throw new ProbeError(
        "USAGE",
        `unknown parameter: ${name}. Known: ${listed(Object.keys(parameters))}.`,
      );
    }
    if (!parameter.values.includes(value)) {
      throw new ProbeError(
        "USAGE",
        `unknown value for ${name}: ${value}. Known: ${listed(parameter.values)}.`,
      );
    }
    selection[name] = value;
  }
  return selection;
}

export type ParameterChoices = Readonly<Record<string, readonly string[]>>;

export function parameterChoices(config: Config): ParameterChoices {
  return Object.fromEntries(
    Object.entries(config.parameters ?? {}).map(([name, { values }]) => [name, values]),
  );
}

/** Every parameter one of the configs declares, with every value one of them lists. */
export function mergedChoices(all: readonly ParameterChoices[]): ParameterChoices {
  const merged: Record<string, string[]> = {};
  for (const choices of all) {
    for (const [name, values] of Object.entries(choices)) {
      const known = Object.hasOwn(merged, name) ? (merged[name] as string[]) : [];
      merged[name] = [...known, ...values.filter((value) => !known.includes(value))];
    }
  }
  return merged;
}

/** The value each parameter takes: the one asked for when it is listed, else the first. */
export function effectiveSelection(
  choices: ParameterChoices,
  selection: Selection = {},
): Selection {
  return Object.fromEntries(
    Object.entries(choices).flatMap(([name, values]) => {
      const asked = Object.hasOwn(selection, name) ? selection[name] : undefined;
      const value = asked !== undefined && values.includes(asked) ? asked : values[0];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function chosenValue(name: string, parameter: Parameter, selection: Selection): string {
  const asked = Object.hasOwn(selection, name) ? selection[name] : undefined;
  return asked !== undefined && parameter.values.includes(asked)
    ? asked
    : (parameter.values[0] as string);
}

/** The services as they are requested for one value of each parameter of the config. */
export function applySelection(
  config: Config,
  selection: Selection = {},
  types: ServiceTypes = serviceType,
): Config {
  const chosen = Object.entries(config.parameters ?? {}).map(
    ([name, parameter]): [Parameter, string] => [
      parameter,
      chosenValue(name, parameter, selection),
    ],
  );
  if (chosen.length === 0) return config;
  const services = Object.fromEntries(
    Object.entries(config.services).map(([name, service]) => {
      const { parameterKinds = [], withParameters } = types(service);
      const understood = chosen.filter(([{ strategy }]) => parameterKinds.includes(strategy.kind));
      return [name, withParameters?.(service, understood) ?? service];
    }),
  );
  return { ...config, services };
}
