import type { ParameterField } from "../commands/parameter-writes";
import { PARAMETER_VALUE_PATTERN, type Parameter, VALUE_EXPECTED } from "../config/schema";
import { nameProblem } from "../config/service-input";

export type ParameterFormValues = Readonly<Record<ParameterField, string>>;

export interface ParameterFormRow {
  key: ParameterField;
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
  const problems: Record<ParameterField, () => string | undefined> = {
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
    query: `${EXAMPLE_URL}?${name || parameter || "tenant"}=${value}`,
    path: EXAMPLE_URL.replace("/health", `/${value}/health`),
    header: `${name || "X-Tenant"}: ${value}`,
    url: `urls: { ${value}: ${value}.example.com }`,
  }[kind];
  return [SAYS[kind], `e.g. ${example}`];
}

export function parameterFormRow(rows: readonly ParameterFormRow[], field: ParameterField): number {
  return Math.max(
    0,
    rows.findIndex(({ key }) => key === field),
  );
}
