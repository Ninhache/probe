import { defaultType } from "../checkers/registry";
import type { FormField, ServiceForm } from "../checkers/types";
import type { ServiceFields } from "../commands/service-writes";
import {
  type HeaderTemplates,
  headerNameProblem,
  headerValueProblem,
  holdsSecret,
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
  [key: FieldKey]: string | readonly string[];
}>;

export const fieldText = (values: FormValues, key: FieldKey): string => {
  const value = values[key];
  return typeof value === "string" ? value : "";
};

const fieldTexts = ({ headers: _, ...fields }: FormValues) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));

export type FormRow = FormField;

export interface FormSecret {
  index: number;
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

const defaultForm = (): ServiceForm => defaultType().form;

export function emptyForm(form: ServiceForm = defaultForm()): FormValues {
  return {
    name: "",
    ...Object.fromEntries(form.fields.map(({ key }) => [key, ""])),
    headers: [],
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

export function formFields(values: FormValues, form: ServiceForm = defaultForm()): ServiceFields {
  return {
    ...form.written(fieldTexts(values)),
    headers: form.headers ? formHeaders(values) : undefined,
  };
}

export function formVariables(values: FormValues): string[] {
  return typedHeaders(values).flatMap(({ line }) => referencedVariables(line));
}

export function withHeaderLine(values: FormValues, index: number, line: string): FormValues {
  const headers = [...values.headers];
  headers[index] = line;
  return { ...values, headers };
}

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
  form: ServiceForm = defaultForm(),
): { row: number; message: string } | undefined {
  for (const [row, { key }] of rows.entries()) {
    const value = fieldText(values, key);
    const message = key === "name" ? nameProblem(value, taken) : form.problem(key, value);
    if (message) return { row, message };
  }
  const seen = new Set<string>();
  for (const { line, index } of typedHeaders(values)) {
    const message = headerProblem(line, seen);
    if (message) return { row: rows.length + index, message };
  }
  return undefined;
}
