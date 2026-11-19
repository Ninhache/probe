import {
  EMPTY_ENVIRONMENT,
  type EnvironmentOrigin,
  environmentFile,
  environmentNameProblem,
} from "../../commands/env-create";
import { ProbeError } from "../../errors";
import type { ModalStack } from "../../tui/modal";
import { type FormHandle, type FormValues, formModal } from "./form-modal";
import type { Panel } from "./panels";

const FORM_WIDTH = 80;
const NAME = "name";
const FROM = "from";

export interface EnvironmentFormContext {
  stack: ModalStack;
  redraw(): void;
  /** The environments a new one can copy, `local` first. */
  sources(): readonly string[];
  /** Every environment shown: a name among them is taken. */
  taken(): readonly string[];
  /** Creates the file and the tab, or throws a `ProbeError`. */
  create(name: string, from: EnvironmentOrigin): Promise<void>;
}

const EMPTY_CHOICE = "empty";
/** An environment may itself be called `empty`: its name keeps the plain choice. */
const emptyChoice = (sources: readonly string[]) =>
  sources.includes(EMPTY_CHOICE) ? `(${EMPTY_CHOICE})` : EMPTY_CHOICE;

/** Asks the name of a new environment and the one whose services it starts from. */
export function environmentFormModal(context: EnvironmentFormContext): Panel {
  const { stack } = context;
  const submit = (values: FormValues, form: FormHandle) => {
    const name = (values[NAME] ?? "").trim();
    const choice = values[FROM] || (context.sources()[0] ?? "");
    const from = choice === emptyChoice(context.sources()) ? EMPTY_ENVIRONMENT : choice;
    const problem =
      environmentNameProblem(name) ??
      (context.taken().includes(name)
        ? `${environmentFile(name)} is already there: edit it, or pick another name.`
        : undefined);
    if (problem) return form.problem(NAME, problem);
    form.busy(true);
    context
      .create(name, from)
      .then(() => {
        form.busy(false);
        form.close();
      })
      .catch((error: unknown) => {
        form.busy(false);
        if (error instanceof ProbeError) form.problem(NAME, error.message);
        else form.problem(NAME, error instanceof Error ? error.message : String(error));
      });
  };
  return formModal({
    title: "new environment",
    width: FORM_WIDTH,
    values: {},
    layout: () => ({
      lines: [
        { id: NAME, label: "Name", placeholder: "prod" },
        {
          id: FROM,
          label: "Copy from",
          choices: [...context.sources(), emptyChoice(context.sources())],
        },
      ],
      notes: ["Copies the services; secret values stay where they are. Empty copies none."],
    }),
    submit,
    stack,
    redraw: context.redraw,
  });
}
