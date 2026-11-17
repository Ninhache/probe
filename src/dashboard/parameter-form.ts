import type { AddressChanges, ParameterField } from "../commands/parameter-writes";
import { PARAMETER_VALUE_PATTERN, type Parameter, VALUE_EXPECTED } from "../config/schema";
import { nameProblem } from "../config/service-input";

// An address has its own lines, under the fields.
type FormField = Exclude<ParameterField, "address">;

export type ParameterFormValues = Readonly<Record<FormField, string>>;

export interface ParameterFormRow {
  key: FormField;
  label: string;
  placeholder: string;
}

const KINDS = ["query", "path", "header", "url"] as const;
type Kind = (typeof KINDS)[number];

const ROWS: readonly ParameterFormRow[] = [
  { key: "name", label: "Name", placeholder: "tenant" },
  { key: "values", label: "Values", placeholder: "acme, globex" },
  { key: "strategy", label: "Sent by", placeholder: "" },
];

// Only a query and a header have a name: path and url have nothing to ask.
const NAME_ROWS: Readonly<Partial<Record<Kind, ParameterFormRow>>> = {
  query: { key: "strategyName", label: "Query", placeholder: "the parameter name by default" },
  header: { key: "strategyName", label: "Header", placeholder: "X-Tenant" },
};

export const EMPTY_PARAMETER_FORM: ParameterFormValues = {
  name: "",
  values: "",
  strategy: "query",
  strategyName: "",
};

/** The way of sending next to `current`, or the one a typed letter starts. */
export function nextKind(current: string, step: 1 | -1 | string): string {
  if (typeof step === "string") return KINDS.find((kind) => kind.startsWith(step)) ?? current;
  const at = KINDS.indexOf(current as Kind);
  return KINDS[(at + step + KINDS.length) % KINDS.length] as string;
}

export const KIND_HINT = `←→ or a letter: ${KINDS.join(", ")}`;

export function parameterFormRows(adding: boolean, strategy: string): readonly ParameterFormRow[] {
  const named = NAME_ROWS[kindOf(strategy) ?? "query"];
  const rows = named ? [...ROWS, named] : ROWS;
  return adding ? rows : rows.filter(({ key }) => key !== "name");
}

export function parameterFormValues({ values, strategy }: Parameter): ParameterFormValues {
  return {
    name: "",
    values: values.join(", "),
    strategy: strategy.kind,
    strategyName: "name" in strategy ? strategy.name : "",
  };
}

const listed = (values: string) =>
  values
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const kindOf = (strategy: string): Kind | undefined => KINDS.find((kind) => kind === strategy);

function valuesProblem(values: string): string | undefined {
  const all = listed(values);
  if (all.length === 0) return "One value or more, e.g. acme, globex";
  const wrong = all.find((value) => !PARAMETER_VALUE_PATTERN.test(value));
  if (wrong !== undefined) return `${wrong}: ${VALUE_EXPECTED}`;
  const twice = all.find((value, index) => all.indexOf(value) !== index);
  return twice === undefined ? undefined : `${twice} is given twice`;
}

function strategyNameProblem(kind: Kind, name: string): string | undefined {
  if (kind === "header" && !name) return "The header to send, e.g. X-Tenant";
  return undefined;
}

/** The first field the config would refuse, before anything is written; the schema has the last word. */
export function parameterFormProblem(
  rows: readonly ParameterFormRow[],
  values: ParameterFormValues,
  taken: Iterable<string>,
): { row: number; message: string } | undefined {
  const kind = kindOf(values.strategy);
  const name = values.strategyName.trim();
  const problems: Record<FormField, () => string | undefined> = {
    name: () => nameProblem(values.name, taken),
    values: () => valuesProblem(values.values),
    strategy: () => (kind ? undefined : `One of ${KINDS.join(", ")}`),
    strategyName: () => (kind ? strategyNameProblem(kind, name) : undefined),
  };
  for (const [row, { key }] of rows.entries()) {
    const message = problems[key]();
    if (message) return { row, message };
  }
  return undefined;
}

/** The parameter a form holds once `parameterFormProblem` finds nothing: a query is named after the parameter by default. */
export function formParameter(values: ParameterFormValues, parameter: string): Parameter {
  const kind = kindOf(values.strategy) ?? "query";
  const name = values.strategyName.trim();
  const strategy: Parameter["strategy"] =
    kind === "query"
      ? { kind, name: name || parameter }
      : kind === "header"
        ? { kind, name }
        : { kind };
  return { values: listed(values.values), strategy };
}

const EXAMPLE_URL = "localhost:3000/health";

const SAYS: Record<Kind, string> = {
  query: "Adds ?name=value to every URL.",
  path: "Puts the value in front of every path.",
  header: "Sends the value in a header.",
  url: "Each service lists an address per value.",
};

/** What the chosen way of sending does, then what it makes of one value, on the example URL. */
export function parameterExample(values: ParameterFormValues, parameter: string): string[] {
  const kind = kindOf(values.strategy) ?? "query";
  const value = listed(values.values)[0] ?? "acme";
  const name = values.strategyName.trim();
  const example = {
    query: `${EXAMPLE_URL}?${name || parameter || "tenant"}=${encodeURIComponent(value)}`,
    path: EXAMPLE_URL.replace("/health", `/${encodeURIComponent(value)}/health`),
    header: `${name || "X-Tenant"}: ${value}`,
    url: `urls: { ${value}: https://${value}.example.com }`,
  }[kind];
  return [SAYS[kind], `e.g. ${example}`];
}

export function parameterFormRow(rows: readonly ParameterFormRow[], field: FormField): number {
  return Math.max(
    0,
    rows.findIndex(({ key }) => key === field),
  );
}

/** Per service, its address for each value: `{ api: { dev: "https://dev.example.com" } }`. */
export type Addresses = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface AddressRow {
  service: string;
  value: string;
}

/** One line per service and value, only when the parameter is sent by `url`. */
export function addressRows(
  values: ParameterFormValues,
  services: readonly string[],
): AddressRow[] {
  if (kindOf(values.strategy) !== "url") return [];
  const listed = [...new Set(valuesOf(values))];
  return services.flatMap((service) => listed.map((value) => ({ service, value })));
}

const valuesOf = (values: ParameterFormValues) => listed(values.values);

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `localhost:3000` is read as a scheme by `new URL`: the text decides, not the parser. */
export const withScheme = (address: string) => {
  const trimmed = address.trim();
  return trimmed === "" || SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`;
};

export const addressOf = (addresses: Addresses, { service, value }: AddressRow) =>
  addresses[service]?.[value] ?? "";

/** What the form changed on the lines it shows; the rest of the file is left to the write. */
export function addressChanges(
  rows: readonly AddressRow[],
  typed: Addresses,
  initial: Addresses,
): AddressChanges {
  const changes: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const address = withScheme(addressOf(typed, row));
    if (address === addressOf(initial, row)) continue;
    changes[row.service] = { ...changes[row.service], [row.value]: address };
  }
  return changes;
}

export function withAddress(
  addresses: Addresses,
  { service, value }: AddressRow,
  address: string,
): Addresses {
  return { ...addresses, [service]: { ...addresses[service], [value]: address } };
}
