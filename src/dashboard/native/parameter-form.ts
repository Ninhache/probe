import { PARAMETER_KINDS } from "../../checkers/registry";
import type { ParameterWrite } from "../../commands/parameter-writes";
import { urlProblem } from "../../config/schema";
import type { ModalStack } from "../../tui/modal";
import type { Editing, ParameterWriteOutcome } from "../editing";
import {
  type AddressRow,
  addressChanges,
  addressRows,
  EMPTY_PARAMETER_FORM,
  formParameter,
  type ParameterFormValues,
  parameterExample,
  parameterFormProblem,
  parameterFormRows,
  parameterFormValues,
  withScheme,
} from "../parameter-form";
import { confirmModal } from "./confirm";
import {
  type FormHandle,
  type FormLayout,
  type FormLine,
  type FormValues,
  formModal,
} from "./form-modal";
import type { Panel } from "./panels";

const FORM_WIDTH = 60;
const ADDRESS_ID = "addr:";
const ADDRESSES_NOTE = "Addresses (empty: the service address)";

export interface ParameterFormContext {
  editing: Editing;
  stack: ModalStack;
  redraw(): void;
  /** Writes and tells the outcome; resolves to what the write answered. */
  write(change: ParameterWrite, done: string): Promise<ParameterWriteOutcome | undefined>;
}

const addressId = ({ service, value }: AddressRow) => `${ADDRESS_ID}${service}\u0000${value}`;

/** The form that adds a parameter, or edits `editing`; the addresses of a `url` one are lines too. */
export function parameterFormModal(context: ParameterFormContext, editing?: string): Panel {
  const { editing: edits, stack } = context;
  const parameter = editing === undefined ? undefined : edits.parameterFields(editing);
  const services = () => Object.keys(edits.addresses());
  const known = edits.addresses();
  const initial: Record<string, string> = {
    ...(parameter ? parameterFormValues(parameter) : EMPTY_PARAMETER_FORM),
  };
  for (const [service, byValue] of Object.entries(known))
    for (const [value, address] of Object.entries(byValue))
      initial[addressId({ service, value })] = address;

  const fieldsOf = (values: FormValues): ParameterFormValues => ({
    name: values.name ?? "",
    values: values.values ?? "",
    strategy: values.strategy || "query",
    strategyName: values.strategyName ?? "",
  });
  const addressesOf = (values: FormValues) => {
    const typed: Record<string, Record<string, string>> = {};
    for (const row of addressRows(fieldsOf(values), services()))
      typed[row.service] = { ...typed[row.service], [row.value]: values[addressId(row)] ?? "" };
    return typed;
  };

  const layout = (values: FormValues): FormLayout => {
    const fields = fieldsOf(values);
    const lines: FormLine[] = parameterFormRows(editing === undefined, fields.strategy).map(
      ({ key, label, placeholder }) => ({
        id: key,
        label,
        placeholder,
        choices: key === "strategy" ? PARAMETER_KINDS : undefined,
      }),
    );
    const addresses = addressRows(fields, services());
    for (const row of addresses)
      lines.push({ id: addressId(row), label: `${row.service} ${row.value}`, placeholder: "" });
    const notes = [
      ...parameterExample(fields, editing ?? fields.name),
      ...(addresses.length > 0 ? [ADDRESSES_NOTE] : []),
    ];
    return { lines, notes };
  };

  const submit = (values: FormValues, form: FormHandle, confirmed = false) => {
    const fields = fieldsOf(values);
    const rows = parameterFormRows(editing === undefined, fields.strategy);
    const lines = addressRows(fields, services());
    const taken = Object.keys(edits.config().parameters ?? {});
    const problem = parameterFormProblem(rows, fields, taken);
    if (problem) return form.problem(rows[problem.row]?.key, problem.message);
    const typed = addressesOf(values);
    for (const line of lines) {
      const address = withScheme(typed[line.service]?.[line.value] ?? "");
      const wrong = address !== "" ? urlProblem(address) : undefined;
      if (wrong)
        return form.problem(addressId(line), `${line.service} ${line.value}: expects ${wrong}`);
    }
    const name = editing ?? fields.name;
    const written = formParameter(fields, name);
    const change = {
      name,
      parameter: written,
      ...(confirmed ? { confirmed } : {}),
      ...(written.strategy.kind === "url"
        ? { addresses: addressChanges(lines, typed, known) }
        : {}),
    };
    form.busy(true);
    void context
      .write(
        editing === undefined ? { kind: "add", ...change } : { kind: "edit", ...change },
        `${editing === undefined ? "Added" : "Saved"} ${name}`,
      )
      .then((outcome) => {
        form.busy(false);
        if (!outcome) return;
        if (outcome.drops) {
          const { drops } = outcome;
          stack.push(
            confirmModal(
              "addresses",
              `Remove ${drops.length} ${drops.length === 1 ? "address" : "addresses"}: ${drops.join(", ")}?`,
              () => submit(values, form, true),
              "y remove · n esc back to the form",
            ),
          );
        } else if (outcome.problem) {
          const { field, address } = outcome.problem;
          const at = lines.find(
            ({ service, value }) => service === address?.service && value === address?.value,
          );
          const id = field === "address" ? (at ? addressId(at) : "values") : field;
          form.problem(id, outcome.problem.message);
        } else if (outcome.saved) form.close();
        context.redraw();
      });
  };

  return formModal({
    title: editing === undefined ? "add a parameter" : `edit ${editing}`,
    width: FORM_WIDTH,
    values: initial,
    layout,
    submit,
    stack,
    redraw: context.redraw,
  });
}
