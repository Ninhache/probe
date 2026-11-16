import { targetUrl } from "../checkers/http";
import { ProbeError } from "../errors";
import { type Config, DEFAULT_PORTS, type Parameter, type Service } from "./schema";

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

// What a service declares itself wins: it is the way to keep one service out of a parameter.
// A value without an entry in `urls` keeps the address of the service.
function rewritten(service: Service, chosen: readonly [Parameter, string][]): Service {
  const headers = { ...service.headers };
  const sent = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
  const segments: string[] = [];
  const queries: [string, string][] = [];
  let address: string | undefined;
  for (const [{ strategy }, value] of chosen) {
    if (strategy.kind === "url") address = service.urls?.[value];
    else if (strategy.kind === "path") segments.push(value);
    else if (strategy.kind === "query") queries.push([strategy.name, value]);
    else if (!sent.has(strategy.name.toLowerCase())) headers[strategy.name] = value;
  }
  const next: Service = { ...service };
  if (Object.keys(headers).length > 0) next.headers = headers;
  if (address !== undefined && URL.canParse(address)) {
    const { hostname, port, protocol, pathname, search } = new URL(address);
    next.url = address;
    next.host = hostname;
    next.port = Number(port) || DEFAULT_PORTS[protocol as keyof typeof DEFAULT_PORTS];
    next.path = pathname + search;
  }
  const target = targetUrl(next);
  if (segments.length + queries.length === 0 || !URL.canParse(target)) return next;

  const url = new URL(target);
  if (segments.length > 0) {
    url.pathname = `/${segments.join("/")}${url.pathname === "/" ? "" : url.pathname}`;
  }
  for (const [name, value] of queries) {
    if (url.searchParams.has(name)) continue;
    // Appended as text: `searchParams.append` would rewrite the query the service declares.
    url.search = `${url.search === "" ? "?" : `${url.search}&`}${name}=${value}`;
  }
  next.path = url.pathname + url.search;
  if (next.url !== undefined) next.url = url.href;
  return next;
}

/** The services as they are requested for one value of each parameter of the config. */
export function applySelection(config: Config, selection: Selection = {}): Config {
  const chosen = Object.entries(config.parameters ?? {}).map(
    ([name, parameter]): [Parameter, string] => [
      parameter,
      chosenValue(name, parameter, selection),
    ],
  );
  if (chosen.length === 0) return config;
  const services = Object.fromEntries(
    Object.entries(config.services).map(([name, service]) => [name, rewritten(service, chosen)]),
  );
  return { ...config, services };
}
