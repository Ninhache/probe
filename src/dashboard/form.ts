import type { ServiceFields } from "../commands/service-writes";
import {
  type HeaderTemplates,
  headerNameProblem,
  headerValueProblem,
  holdsSecret,
  parseHeaderLine,
  reference,
  splitSecret,
  variableValueProblem,
} from "../config/headers";
import {
  expectProblem,
  hostProblem,
  nameProblem,
  parseExpectList,
  pathProblem,
  portProblem,
} from "../config/service-input";

export type FieldKey = "name" | "port" | "host" | "path" | "expect";

export type FormValues = Readonly<Record<FieldKey, string>> & {
  /** One `Name: value` per header, as typed: an empty line is a header to drop. */
  readonly headers: readonly string[];
};

export interface FormRow {
  key: FieldKey;
  label: string;
  placeholder: string;
}

export interface FormSecret {
  index: number;
  header: string;
  scheme: string;
  secret: string;
}

const ROWS: readonly FormRow[] = [
  { key: "name", label: "Name", placeholder: "api" },
  { key: "port", label: "Port", placeholder: "3000" },
  { key: "host", label: "Host", placeholder: "localhost" },
  { key: "path", label: "Path", placeholder: "/" },
  { key: "expect", label: "Expect", placeholder: "any 2xx" },
];

export const HEADER_LABEL = "Header";
export const HEADER_PLACEHOLDER = "Accept: application/json";

export const EMPTY_FORM: FormValues = {
  name: "",
  port: "",
  host: "",
  path: "",
  expect: "",
  headers: [],
};

export function formRows(adding: boolean): readonly FormRow[] {
  return adding ? ROWS : ROWS.filter(({ key }) => key !== "name");
}

export function formValues({ host, port, path, expect, headers }: ServiceFields): FormValues {
  return {
    name: "",
    port: String(port),
    host,
    path,
    expect: [expect ?? []].flat().join(","),
    headers: Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${value}`),
  };
}

const typedHeaders = (values: FormValues) =>
  values.headers.flatMap((line, index) => (line.trim() ? [{ line, index }] : []));

function formHeaders(values: FormValues): HeaderTemplates | undefined {
  const headers = typedHeaders(values).flatMap(({ line }) => {
    const parsed = parseHeaderLine(line);
    return parsed ? [parsed] : [];
  });
  return headers.length > 0 ? Object.fromEntries(headers) : undefined;
}

export function formFields(values: FormValues): ServiceFields {
  return {
    port: Number(values.port),
    host: values.host || "localhost",
    path: values.path || "/",
    expect: values.expect ? parseExpectList(values.expect) : undefined,
    headers: formHeaders(values),
  };
}

export function withHeaderLine(values: FormValues, index: number, line: string): FormValues {
  const headers = [...values.headers];
  headers[index] = line;
  return { ...values, headers };
}

/** The first header whose value is a secret typed in clear: it must become a variable. */
export function formSecret(values: FormValues): FormSecret | undefined {
  for (const { line, index } of typedHeaders(values)) {
    const [header, value] = parseHeaderLine(line) ?? [];
    if (header === undefined || value === undefined || !holdsSecret(header, value)) continue;
    return { index, header, ...splitSecret(value) };
  }
  return undefined;
}

export function withVariable(values: FormValues, found: FormSecret, variable: string): FormValues {
  return withHeaderLine(
    values,
    found.index,
    `${found.header}: ${found.scheme}${reference(variable)}`,
  );
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
): { row: number; message: string } | undefined {
  const problems: Record<FieldKey, () => string | undefined> = {
    name: () => nameProblem(values.name, taken),
    port: () => portProblem(values.port),
    host: () => (values.host ? hostProblem(values.host) : undefined),
    path: () => (values.path ? pathProblem(values.path) : undefined),
    expect: () => (values.expect ? expectProblem(values.expect) : undefined),
  };
  for (const [row, { key }] of rows.entries()) {
    const message = problems[key]();
    if (message) return { row, message };
  }
  const seen = new Set<string>();
  for (const { line, index } of typedHeaders(values)) {
    const message = headerProblem(line, seen);
    if (message) return { row: rows.length + index, message };
  }
  return undefined;
}
