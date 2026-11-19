import type { ServiceForm } from "../../checkers/types";
import type { ServiceWrite } from "../../commands/service-writes";
import { hiddenHeaderLine, serviceVariables } from "../../config/headers";
import { urlProblem } from "../../config/schema";
import { CONFIG_FILE, ENVIRONMENTS_DIR, LOCAL_FILE, PROBE_DIR } from "../../constants";
import type { InputEvent } from "../../tui/input";
import type { ModalStack } from "../../tui/modal";
import { drawField, fieldKey, fieldValue, textField } from "../../tui/textfield";
import { defaultTheme as t } from "../../tui/theme";
import type { Editing, Secrets } from "../editing";
import {
  emptyForm,
  type FormSecret,
  formFields,
  formProblem,
  formRows,
  formSecret,
  formValues,
  formVariables,
  HEADER_LABEL,
  HEADER_PLACEHOLDER,
  type FormValues as InkValues,
  urlLabel,
  withVariable,
} from "../form";
import { withScheme } from "../parameter-form";
import {
  type FormHandle,
  type FormLayout,
  type FormLine,
  type FormValues,
  formModal,
} from "./form-modal";
import type { Panel } from "./panels";

const FORM_WIDTH = 56;
const SECRET_WIDTH = 60;
const BULLET = "•";
const HEADER_ID = "header:";
const URL_ID = "url:";
const NAME_ID = "name";
const URL_PLACEHOLDER = "https://staging.example.com";
const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;

/** The file a form writes: an environment's own file, or config.yml. */
const fileOf = (target: string | undefined) =>
  target === undefined ? CONFIG_FILE : `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${target}.yml`;

export interface ServiceFormContext {
  editing: Editing;
  stack: ModalStack;
  redraw(): void;
  /** The environment whose file the form writes; absent for config.yml. */
  target?: string;
  /** Writes the change and tells the outcome; resolves once the files are written. */
  write(change: ServiceWrite, done: string, secrets?: Secrets): Promise<void>;
}

const headerIndexes = (values: FormValues) =>
  Object.keys(values)
    .filter((id) => id.startsWith(HEADER_ID))
    .map((id) => Number(id.slice(HEADER_ID.length)));

/** One header line per typed one, then the empty line that adds another. */
const headerCount = (values: FormValues, enabled: boolean) => {
  if (!enabled) return 0;
  const typed = headerIndexes(values).filter((i) => (values[`${HEADER_ID}${i}`] ?? "").trim());
  return (typed.length === 0 ? 0 : Math.max(...typed) + 1) + 1;
};

const headersOf = (values: FormValues): string[] => {
  const last = Math.max(-1, ...headerIndexes(values));
  return Array.from({ length: last + 1 }, (_, i) => values[`${HEADER_ID}${i}`] ?? "");
};

/** The values the shared form module reads: the lines typed in the modal, headers as a list. */
function inkValues(values: FormValues, spec: ServiceForm): InkValues {
  const fields = Object.fromEntries(
    [NAME_ID, ...spec.fields.map(({ key }) => key)].map((key) => [key, values[key] ?? ""]),
  );
  return { ...fields, headers: spec.headers ? headersOf(values) : [] };
}

/** The values of the modal for a service as it is written: the reverse of `inkValues`. */
function modalValues(values: InkValues, urls: Readonly<Record<string, string>>): FormValues {
  const { headers, ...fields } = values;
  return {
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])),
    ...Object.fromEntries(headers.map((line, i) => [`${HEADER_ID}${i}`, line])),
    ...Object.fromEntries(Object.entries(urls).map(([value, url]) => [`${URL_ID}${value}`, url])),
  };
}

const formTitle = (editing: string | undefined, target: string | undefined) => {
  if (editing === undefined) return target === undefined ? "add a service" : `add to ${target}`;
  return target === undefined ? `edit ${editing}` : `edit ${editing} in ${target}`;
};

/** The form that adds a service, or edits `editing`. */
export function serviceFormModal(context: ServiceFormContext, editing?: string): Panel {
  const { editing: edits, stack } = context;
  const spec = edits.serviceForm(editing);
  const url = spec.replacedByUrl?.size ? edits.urlParameter() : undefined;
  const fields = editing === undefined ? undefined : edits.serviceFields(editing);
  const initial = modalValues(
    fields ? formValues(fields, spec) : emptyForm(spec),
    editing === undefined ? {} : (edits.addresses()[editing] ?? {}),
  );
  const firstReplaced = spec.fields.find(({ key }) => spec.replacedByUrl?.has(key))?.key;
  // A secret named before its header was retyped or removed is kept nowhere.
  let secrets: Secrets | undefined;

  const overridden = (values: FormValues) =>
    (url?.values ?? []).filter((value) => (values[`${URL_ID}${value}`] ?? "").trim() !== "");

  const layout = (values: FormValues): FormLayout => {
    const lines: FormLine[] = [];
    if (editing === undefined) lines.push({ id: NAME_ID, label: "Name", placeholder: "api" });
    for (const field of spec.fields) {
      if (url && field.key === firstReplaced)
        for (const value of url.values)
          lines.push({
            id: `${URL_ID}${value}`,
            label: urlLabel(value),
            placeholder: URL_PLACEHOLDER,
          });
      lines.push({
        id: field.key,
        label: field.label,
        placeholder: field.placeholder,
        choices: field.choices,
        muted:
          url !== undefined && spec.replacedByUrl?.has(field.key) && overridden(values).length > 0,
      });
    }
    const count = headerCount(values, spec.headers === true);
    for (let i = 0; i < count; i += 1)
      lines.push({
        id: `${HEADER_ID}${i}`,
        label: HEADER_LABEL,
        placeholder: HEADER_PLACEHOLDER,
        shown: (line) => hiddenHeaderLine(line, BULLET),
      });
    const notes =
      url && overridden(values).length > 0
        ? [`An address under ${url.name} replaces the host, port and path.`]
        : [];
    return { lines, notes };
  };

  const rowId = (rows: readonly { key: string }[], row: number) =>
    rows[row]?.key ?? `${HEADER_ID}${row - rows.length}`;

  const submit = (values: FormValues, form: FormHandle) => {
    const rows = formRows(editing === undefined, spec);
    const known = inkValues(values, spec);
    const taken = Object.keys(edits.config().services);
    // With an address on every URL line, the service needs none of its own.
    const replaced = url && overridden(values).length === url.values.length;
    const relaxed: ServiceForm = replaced
      ? {
          ...spec,
          problem: (key, value) =>
            spec.replacedByUrl?.has(key) && value.trim() === ""
              ? undefined
              : spec.problem(key, value),
        }
      : spec;
    const problem = formProblem(rows, known, taken, relaxed);
    if (problem) return form.problem(rowId(rows, problem.row), problem.message);
    const urls = Object.fromEntries(
      (url?.values ?? []).map((value) => [value, withScheme(values[`${URL_ID}${value}`] ?? "")]),
    );
    for (const value of url?.values ?? []) {
      const wrong = urls[value] ? urlProblem(urls[value]) : undefined;
      if (wrong) return form.problem(`${URL_ID}${value}`, `${urlLabel(value)} expects ${wrong}`);
    }
    const service = editing ?? known.name?.toString() ?? "";
    const secret = formSecret(known);
    if (secret) {
      const id = `${HEADER_ID}${secret.index}`;
      if (!edits.variables)
        return form.problem(
          id,
          `${secret.header} expects a reference, e.g. \${API_TOKEN}: ${fileOf(context.target)} is shared`,
        );
      return keepSecret(form, values, secret, service, id);
    }
    const written = formFields(known, spec);
    const sent = serviceVariables(written.headers);
    const kept = Object.entries(secrets ?? {}).filter(([name]) => sent.includes(name));
    const keptSecrets = kept.length > 0 ? Object.fromEntries(kept) : undefined;
    const sentUrls = url ? { urls } : {};
    form.close();
    if (editing === undefined)
      void context.write(
        { kind: "add", name: service, fields: written, ...sentUrls },
        `Added ${service}`,
        keptSecrets,
      );
    else
      void context.write(
        { kind: "edit", name: service, fields: written, ...sentUrls },
        `Saved ${service}`,
        keptSecrets,
      );
  };

  const keepSecret = (
    form: FormHandle,
    values: FormValues,
    secret: FormSecret,
    service: string,
    id: string,
  ) => {
    form.busy(true);
    const used = formVariables(inkValues(values, spec));
    void edits.variables?.variableName(service, secret.header, used).then((variable) => {
      form.busy(false);
      stack.push(
        secretModal(secret, variable, used, service, edits, context, (chosen) => {
          secrets = { ...secrets, [chosen]: secret.secret };
          const next = withVariable(inkValues(values, spec), secret, chosen);
          form.set({ [id]: next.headers[secret.index] ?? "" });
          stack.pop();
          submit({ ...values, [id]: next.headers[secret.index] ?? "" }, form);
        }),
      );
      context.redraw();
    });
  };

  const modal = formModal({
    title: formTitle(editing, context.target),
    width: FORM_WIDTH,
    values: initial,
    layout,
    submit,
    stack,
    redraw: context.redraw,
  });
  return modal;
}

/** Asks which variable of local.yml keeps a secret typed in a header: config.yml gets a reference. */
function secretModal(
  secret: FormSecret,
  proposed: string,
  taken: readonly string[],
  service: string,
  edits: Editing,
  { redraw, target }: ServiceFormContext,
  chosen: (variable: string) => void,
): Panel {
  let name = textField(proposed);
  let problem: string | undefined;
  let waiting = false;
  return {
    title: `${secret.header} holds a secret`,
    bar: "input",
    typing: true,
    size: { w: SECRET_WIDTH, h: 6 },
    draw(screen, inner) {
      const lines =
        target === undefined
          ? [`${CONFIG_FILE} gets a reference, ${LOCAL} the value.`]
          : [`${fileOf(target)} gets a reference,`, `${LOCAL} the value, for ${target} only.`];
      for (const [i, line] of lines.entries())
        screen.text(inner.x + 1, inner.y + i, line, { fg: t.muted }, inner.w - 2);
      const label = screen.text(inner.x + 1, inner.y + 2, "Variable  ", { fg: t.fg });
      name = drawField(screen, inner.x + 1 + label, inner.y + 2, inner.w - label - 2, name, {
        fg: t.fg,
      });
      if (problem) screen.text(inner.x + 1, inner.y + 4, problem, { fg: t.warn }, inner.w - 2);
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key") return true;
      if (waiting) return true;
      if (event.name === "escape" && !event.ctrl && !event.alt) return false;
      if (event.name === "enter") {
        const variable = fieldValue(name);
        // Under a name another header of the form sends, that header would send this secret.
        if (taken.includes(variable)) {
          problem = `${variable} already keeps another header`;
          return true;
        }
        waiting = true;
        void edits.variables?.variableProblem(variable, service).then((wrong) => {
          waiting = false;
          if (wrong) problem = wrong;
          else chosen(variable);
          redraw();
        });
        return true;
      }
      const next = fieldKey(name, event);
      if (fieldValue(next) !== fieldValue(name)) problem = undefined;
      name = next;
      return true;
    },
  };
}
