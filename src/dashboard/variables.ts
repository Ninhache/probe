import { reference, serviceVariables, VARIABLE_NAME } from "../config/headers";
import type { VariableSource } from "../config/local";
import type { Config } from "../config/schema";

export interface VariableRow {
  name: string;
  source?: VariableSource;
}

/** `env` looks the values up for that environment alone: none falls back on another's. */
export type VariableSources = (
  names: readonly string[],
  env?: string,
) => Promise<Readonly<Record<string, VariableSource | undefined>>>;

export interface VariableTools {
  serviceVariables: (service: string) => Promise<VariableRow[]>;
  variableProblem: (name: string, service: string) => Promise<string | undefined>;
  variableName: (service: string, header: string, taken: readonly string[]) => Promise<string>;
}

const constant = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export function proposedVariable(service: string, header: string): string {
  const what = header.toLowerCase() === "authorization" ? "TOKEN" : constant(header);
  const name = `${constant(service)}_${what.replace(/^X_/, "")}`;
  return VARIABLE_NAME.test(name) ? name : `_${name}`;
}

// Only names and where they are set come through here: a value never reaches the screen.
export function variableTools(
  config: () => Config,
  sources: (names: readonly string[]) => ReturnType<VariableSources>,
): VariableTools {
  const sentBy = (service: string) => serviceVariables(config().services[service]?.headers);
  const variableProblem: VariableTools["variableProblem"] = async (name, service) => {
    if (!VARIABLE_NAME.test(name)) return "Letters, digits and _ only, e.g. API_TOKEN";
    const instead = `another name, or ${reference(name)} in the header`;
    // Under a name another service sends, the secret would go to that service too.
    const others = Object.keys(config().services).filter(
      (other) => other !== service && sentBy(other).includes(name),
    );
    if (others.length > 0) return `${name} is already sent by ${others.join(", ")}: ${instead}`;
    const source = (await sources([name]))[name];
    if (source === "environment") return `${name} is set in the environment: ${instead}`;
    if (source === "local" && !sentBy(service).includes(name))
      return `${name} is already set: ${instead}`;
    return undefined;
  };
  return {
    async serviceVariables(service) {
      const names = sentBy(service);
      const found = await sources(names);
      return names.map((name) => ({ name, source: found[name] }));
    },
    variableProblem,
    async variableName(service, header, taken) {
      const base = proposedVariable(service, header);
      for (let count = 1; ; count += 1) {
        const name = count === 1 ? base : `${base}_${count}`;
        if (!taken.includes(name) && !(await variableProblem(name, service))) return name;
      }
    },
  };
}
