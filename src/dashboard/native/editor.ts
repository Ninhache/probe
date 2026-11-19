import { type EnvironmentOrigin, environmentFile } from "../../commands/env-create";
import type { ParameterWrite } from "../../commands/parameter-writes";
import type { ServiceWrite } from "../../commands/service-writes";
import { CONFIG_FILE, LOCAL_ENVIRONMENT, LOCAL_FILE, PROBE_DIR } from "../../constants";
import type { Editing, Secrets } from "../editing";
import type { VariableRow } from "../variables";
import { confirmModal } from "./confirm";
import { environmentFormModal } from "./environment-form";
import type { Tracker } from "./history";
import { parameterFormModal } from "./parameter-form";
import { serviceFormModal } from "./service-form";
import { variableModal } from "./variable-modal";
import { say, type ViewState } from "./view";

const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;

/** What the keys that edit the files do: each opens a modal or writes, then says what happened. */
export interface Editor {
  /** Says why this environment is not edited here, if it is not. */
  elsewhere(env: string | undefined): string | undefined;
  add(): void;
  edit(service: string): void;
  remove(service: string): void;
  undo(): void;
  redo(): void;
  /** Opens the form of a new environment; absent when none can be created. */
  environment?(): void;
  /** Asks, then deletes the file of the environment whose tab is open; `undefined` is the `all` tab. Absent when none can be removed. */
  removeEnvironment?(env: string | undefined): void;
  /** The keys of the parameters panel; absent when no writer was given. */
  parameters?: {
    add(): void;
    edit(name: string): void;
    remove(name: string): void;
  };
  /** The variables the headers of a service send; absent when none can be looked up. */
  variables?: {
    load(service: string): Promise<VariableRow[]>;
    /** `done` runs once the value is kept: the rows are then looked up again. */
    set(row: VariableRow, done: () => void): void;
  };
}

export interface EditorDeps {
  view: ViewState;
  tracker: Tracker;
  editing: Editing;
  /** The files changed: the services and parameters are read again and a pass starts. `restart` also forgets what was measured. */
  changed(restart?: boolean): void;
  /** Creates an environment and its tab; resolves to what to tell. Absent where none can be created. */
  createEnvironment?(name: string, from: EnvironmentOrigin): Promise<string>;
  /** Deletes the file of an environment, undoably; resolves to why it could not. Absent where none can be removed. */
  removeEnvironment?(name: string): Promise<string | undefined>;
  /** The files of the other environments that declare this parameter. */
  declaredIn(parameter: string): string[];
  redraw(): void;
  /** The file an environment comes from, when it is not the local config. */
  fileOf(env: string): string | undefined;
}

/** The writes of the editing keys; undefined when the command line gave no writer. */
export function createEditor({
  view,
  editing,
  changed,
  redraw,
  fileOf,
  declaredIn,
  tracker,
  createEnvironment,
  removeEnvironment,
}: EditorDeps): Editor {
  const { writeService, writeParameter, variables, writeVariable } = editing;

  const write = async (change: ServiceWrite, done: string, secrets?: Secrets) => {
    const outcome = await writeService?.(change, secrets);
    if (!outcome) return;
    view.unsaved = outcome.failure;
    if (outcome.saved) {
      const kept = Object.keys(secrets ?? {});
      const told =
        kept.length > 0 && outcome.failure === undefined
          ? `${done}, ${kept.join(", ")} kept in ${LOCAL}`
          : done;
      const notes = [outcome.warning ? `${told}\n${outcome.warning}` : told, outcome.failure];
      say(view, notes.filter(Boolean).join("\n"));
      if (change.kind === "remove") {
        // A service added later under the same name starts without the timeout of this one.
        const { [change.name]: _, ...others } = view.timeouts;
        view.timeouts = others;
      }
      changed();
    } else if (outcome.failure) say(view, `not saved: ${outcome.failure}`);
    redraw();
  };

  const context = { editing, stack: view.modals, redraw, write };

  // Another value is another target: the latencies and the states start again.
  const parameterWritten = (name: string, done: string) => {
    say(view, done);
    view.parameterAt = name;
    changed(true);
  };
  const parameterContext = {
    editing,
    stack: view.modals,
    redraw,
    async write(change: ParameterWrite, done: string) {
      const outcome = await writeParameter?.(change);
      if (!outcome || outcome.drops || outcome.problem) return outcome;
      view.unsaved = outcome.failure;
      if (outcome.failure) say(view, `not saved: ${outcome.failure}`);
      if (outcome.saved) parameterWritten(change.name, done);
      return outcome;
    },
  };
  // Only the parameters of config.yml are written here: one an environment declares says its file.
  const ownParameter = (name: string) => {
    if (editing.parameterFields(name)) return true;
    say(
      view,
      `${name} is not in ${PROBE_DIR}/${CONFIG_FILE}: change it in ${declaredIn(name).join(", ")}`,
    );
    return false;
  };
  const history = async (way: "undo" | "redo") => {
    const outcome = await editing[way]?.();
    if (!outcome) return;
    say(view, outcome.undone ?? outcome.failure ?? "");
    if (outcome.timeouts) {
      view.timeouts = outcome.timeouts;
      changed();
    }
    redraw();
  };
  return {
    elsewhere: (env) => {
      const file = env === undefined ? undefined : fileOf(env);
      return file === undefined ? undefined : `${env} is not edited here: change ${file}`;
    },
    add() {
      if (writeService) view.modals.push(serviceFormModal(context));
    },
    edit(service) {
      if (!writeService || !editing.serviceFields(service)) return;
      view.modals.push(serviceFormModal(context, service));
    },
    remove(service) {
      if (!writeService || !editing.config().services[service]) return;
      view.modals.push(
        confirmModal(
          `remove ${service}`,
          `Remove ${service} from the config?`,
          () => void write({ kind: "remove", name: service }, `Removed ${service}`),
        ),
      );
    },
    undo: () => void history("undo"),
    redo: () => void history("redo"),
    environment:
      createEnvironment &&
      (() =>
        view.modals.push(
          environmentFormModal({
            stack: view.modals,
            redraw,
            sources: () => [
              LOCAL_ENVIRONMENT,
              ...tracker.environments.filter((e) => e !== LOCAL_ENVIRONMENT),
            ],
            taken: () => tracker.environments,
            create: async (name, from) => {
              say(view, await createEnvironment(name, from));
            },
          }),
        )),
    removeEnvironment:
      removeEnvironment &&
      ((env) => {
        if (env === undefined) return say(view, "Open the tab of an environment to remove it");
        if (env === LOCAL_ENVIRONMENT)
          return say(
            view,
            `${LOCAL_ENVIRONMENT} is ${environmentFile(LOCAL_ENVIRONMENT)}: it cannot be removed`,
          );
        const file = environmentFile(env);
        view.modals.push(
          confirmModal(
            `remove ${env}`,
            `Remove ${env}? ${file} is deleted. Its values in ${LOCAL} stay.`,
            () =>
              void removeEnvironment(env).then((failure) => {
                view.unsaved = failure;
                say(
                  view,
                  failure
                    ? `not saved: ${failure}`
                    : `Removed ${env}: ${file} is deleted, its values in ${LOCAL} stay. z undoes`,
                );
                if (!failure) changed();
                redraw();
              }),
          ),
        );
      }),
    parameters: writeParameter && {
      add: () => view.modals.push(parameterFormModal(parameterContext)),
      edit(name) {
        if (ownParameter(name)) view.modals.push(parameterFormModal(parameterContext, name));
      },
      remove(name) {
        if (!ownParameter(name)) return;
        view.modals.push(
          confirmModal(
            `remove ${name}`,
            `Remove the parameter ${name} from the config?`,
            () =>
              void writeParameter({ kind: "remove", name }).then((outcome) => {
                view.unsaved = outcome.failure;
                if (outcome.failure) say(view, `not saved: ${outcome.failure}`);
                if (outcome.problem) say(view, outcome.problem.message);
                else if (outcome.saved) parameterWritten(name, `Removed ${name}`);
                redraw();
              }),
          ),
        );
      },
    },
    variables: variables && {
      load: (service) => variables.serviceVariables(service),
      set({ name, source }, done) {
        if (!writeVariable) return;
        if (source === "environment")
          return say(view, `${name} comes from the environment, which is read first`);
        view.modals.push(
          variableModal(name, (value) => {
            void writeVariable(name, value).then((failure) => {
              view.unsaved = failure;
              say(
                view,
                failure
                  ? `not saved: ${failure}`
                  : `Kept ${name} in ${LOCAL}, for this machine only`,
              );
              if (!failure) {
                changed();
                done();
              }
              redraw();
            });
          }),
        );
      },
    },
  };
}
