import type { ServiceFields } from "../commands/service-writes";
import {
  expectProblem,
  hostProblem,
  nameProblem,
  parseExpectList,
  pathProblem,
  portProblem,
} from "../config/service-input";

export type FieldKey = "name" | "port" | "host" | "path" | "expect";

/** What is typed in each field of the form; empty means the default. */
export type FormValues = Readonly<Record<FieldKey, string>>;

export interface FormRow {
  key: FieldKey;
  label: string;
  /** Shown while the field is empty: an example, or what empty means. */
  placeholder: string;
}

const ROWS: readonly FormRow[] = [
  { key: "name", label: "Name", placeholder: "api" },
  { key: "port", label: "Port", placeholder: "3000" },
  { key: "host", label: "Host", placeholder: "localhost" },
  { key: "path", label: "Path", placeholder: "/" },
  { key: "expect", label: "Expect", placeholder: "any 2xx" },
];

export const EMPTY_FORM: FormValues = { name: "", port: "", host: "", path: "", expect: "" };

/** The fields of the form: a service being edited keeps its name. */
export function formRows(adding: boolean): readonly FormRow[] {
  return adding ? ROWS : ROWS.filter(({ key }) => key !== "name");
}

/** The form filled with what a service has now. */
export function formValues({ host, port, path, expect }: ServiceFields): FormValues {
  return { name: "", port: String(port), host, path, expect: [expect ?? []].flat().join(",") };
}

/** What the form says the service is; call it once `formProblem` finds nothing. */
export function formFields(values: FormValues): ServiceFields {
  return {
    port: Number(values.port),
    host: values.host || "localhost",
    path: values.path || "/",
    expect: values.expect ? parseExpectList(values.expect) : undefined,
  };
}

/** The first field that cannot be saved as typed, and why; `taken`: the names already used. */
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
  return undefined;
}
