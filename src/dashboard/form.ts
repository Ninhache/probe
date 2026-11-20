import { defaultType } from "../checkers/registry";
import type { FormField, ServiceForm } from "../checkers/types";
import type { ServiceFields } from "../commands/service-writes";
import {
  envNameProblem,
  envValueProblem,
  type HeaderTemplates,
  headerNameProblem,
  headerValueProblem,
  holdsEnvSecret,
  holdsSecret,
  parseEnvLine,
  parseHeaderLine,
  reference,
  referencedVariables,
  splitSecret,
  variableValueProblem,
} from "../config/headers";
import { nameProblem } from "../config/service-input";

export type FieldKey = string;

// `headers` is the only list: every other key is the text of a field.
export type FormValues = Readonly<{
  headers: readonly string[];
  /** One `NAME=value` line per variable; only a command service has them. */
  env?: readonly string[];
  [key: FieldKey]: string | readonly string[] | undefined;
}>;

/** The two kinds of lines under the fields: each has its own way of writing a name and a value. */
export type LineKind = "headers" | "env";

export const fieldText = (values: FormValues, key: FieldKey): string => {
  const value = values[key];
  return typeof value === "string" ? value : "";
};

const fieldTexts = ({ headers: _, env: __, ...fields }: FormValues) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));

export type FormRow = FormField;

export interface FormSecret {
  kind: LineKind;
  index: number;
  /** The name of the header or of the variable the secret is for. */
  header: string;
  scheme: string;
  secret: string;
}

const NAME_ROW: FormRow = { key: "name", label: "Name", placeholder: "api" };

/** The `url` parameter of the config: a service can have its own address for each value. */
export interface UrlParameter {
  name: string;
  values: readonly string[];
}

export const urlLabel = (value: string) => `URL ${value}`;

export const HEADER_LABEL = "Header";
export const HEADER_PLACEHOLDER = "Accept: application/json";
export const ENV_LABEL = "Env";
export const ENV_PLACEHOLDER = "MYSQL_HOST=127.0.0.1";

const defaultForm = (): ServiceForm => defaultType().form;

export function emptyForm(form: ServiceForm = defaultForm()): FormValues {
  return {
    name: "",
    ...Object.fromEntries(form.fields.map(({ key }) => [key, ""])),
    headers: [],
    ...(form.env ? { env: [] } : {}),
  };
}

export function formRows(adding: boolean, form: ServiceForm = defaultForm()): readonly FormRow[] {
  return adding ? [NAME_ROW, ...form.fields] : form.fields;
}

export function formValues(fields: ServiceFields, form: ServiceForm = defaultForm()): FormValues {
  return {
    name: "",
    ...form.read(fields),
    headers: form.headers
      ? Object.entries(fields.headers ?? {}).map(([name, value]) => `${name}: ${value}`)
      : [],
    ...(form.env
      ? { env: Object.entries(fields.env ?? {}).map(([name, value]) => `${name}=${value}`) }
      : {}),
  };
}

const linesOf = (values: FormValues, kind: LineKind): readonly string[] => values[kind] ?? [];

const typedLines = (values: FormValues, kind: LineKind) =>
  linesOf(values, kind).flatMap((line, index) => (line.trim() ? [{ line, index }] : []));

const typedHeaders = (values: FormValues) => typedLines(values, "headers");

const KINDS: readonly LineKind[] = ["headers", "env"];

function formHeaders(values: FormValues): HeaderTemplates | undefined {
  const headers = typedHeaders(values).flatMap(({ line }) => {
    const parsed = parseHeaderLine(line);
    return parsed ? [parsed] : [];
  });
  return headers.length > 0 ? Object.fromEntries(headers) : undefined;
}

function formEnv(values: FormValues): HeaderTemplates | undefined {
  const env = typedLines(values, "env").flatMap(({ line }) => {
    const parsed = parseEnvLine(line);
    return parsed ? [parsed] : [];
  });
  return env.length > 0 ? Object.fromEntries(env) : undefined;
}

export function formFields(values: FormValues, form: ServiceForm = defaultForm()): ServiceFields {
  return {
    ...form.written(fieldTexts(values)),
    headers: form.headers ? formHeaders(values) : undefined,
    env: form.env ? formEnv(values) : undefined,
  };
}

export function formVariables(values: FormValues): string[] {
  return KINDS.flatMap((kind) =>
    typedLines(values, kind).flatMap(({ line }) => referencedVariables(line)),
  );
}

export function withLine(
  values: FormValues,
  kind: LineKind,
  index: number,
  line: string,
): FormValues {
  const lines = [...linesOf(values, kind)];
  lines[index] = line;
  return { ...values, [kind]: lines };
}

export const withHeaderLine = (values: FormValues, index: number, line: string): FormValues =>
  withLine(values, "headers", index, line);

export function formSecret(values: FormValues): FormSecret | undefined {
  for (const { line, index } of typedLines(values, "headers")) {
    const [header, value] = parseHeaderLine(line) ?? [];
    if (header === undefined || value === undefined || !holdsSecret(header, value)) continue;
    return { kind: "headers", index, header, ...splitSecret(value) };
  }
  for (const { line, index } of typedLines(values, "env")) {
    const [name, value] = parseEnvLine(line) ?? [];
    if (name === undefined || value === undefined || !holdsEnvSecret(name, value)) continue;
    return { kind: "env", index, header: name, scheme: "", secret: value };
  }
  return undefined;
}

export function withVariable(values: FormValues, found: FormSecret, variable: string): FormValues {
  const line =
    found.kind === "env"
      ? `${found.header}=${reference(variable)}`
      : `${found.header}: ${found.scheme}${reference(variable)}`;
  return withLine(values, found.kind, found.index, line);
}

function envProblem(line: string, seen: Set<string>): string | undefined {
  const parsed = parseEnvLine(line);
  if (!parsed) return `A variable as NAME=value, e.g. ${ENV_PLACEHOLDER}`;
  const [name, value] = parsed;
  const wrongName = envNameProblem(name);
  if (wrongName) return `Expects ${wrongName}`;
  if (seen.has(name)) return `${name} is given twice`;
  seen.add(name);
  const wrongValue = holdsEnvSecret(name, value)
    ? variableValueProblem(value)
    : envValueProblem(name, value);
  return wrongValue && `${name} expects ${wrongValue}`;
}

// No message repeats a value: it may be the secret.
function headerProblem(line: string, seen: Set<string>): string | undefined {
  const parsed = parseHeaderLine(line);
  if (!parsed) return `A header as Name: value, e.g. ${HEADER_PLACEHOLDER}`;
  const [name, value] = parsed;
  const wrongName = headerNameProblem(name);
  if (wrongName) return `Expects ${wrongName}`;
  if (seen.has(name.toLowerCase())) return `${name} is given twice`;
  seen.add(name.toLowerCase());
  const wrongValue = holdsSecret(name, value)
    ? variableValueProblem(splitSecret(value).secret)
    : headerValueProblem(name, value);
  return wrongValue && `${name} expects ${wrongValue}`;
}

export function formProblem(
  rows: readonly FormRow[],
  values: FormValues,
  taken: Iterable<string>,
  form: ServiceForm = defaultForm(),
): { row: number; message: string; line?: { kind: LineKind; index: number } } | undefined {
  for (const [row, { key }] of rows.entries()) {
    const value = fieldText(values, key);
    const message = key === "name" ? nameProblem(value, taken) : form.problem(key, value);
    if (message) return { row, message };
  }
  const seen = new Set<string>();
  for (const { line, index } of typedHeaders(values)) {
    const message = headerProblem(line, seen);
    if (message) return { row: rows.length + index, message, line: { kind: "headers", index } };
  }
  const names = new Set<string>();
  for (const { line, index } of typedLines(values, "env")) {
    const message = envProblem(line, names);
    if (message) {
      const row = rows.length + values.headers.length + index;
      return { row, message, line: { kind: "env", index } };
    }
  }
  return undefined;
}
