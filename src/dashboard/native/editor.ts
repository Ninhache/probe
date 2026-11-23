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

// Shown on the local tab but not in config.yml: local.yml adds it, and the dashboard writes config.yml.
const notIn = (service: string, env: string | undefined) =>
  env
    ? `${service} is not in ${env}`
    : `${service} is in ${LOCAL}, under extraServices: change it there`;

/** What the keys that edit the files do: each opens a modal or writes, then says what happened. */
export interface Editor {
  /** `env` is the environment whose file is written; absent or local, it is config.yml. */
  add(env?: string): void;
  edit(service: string, env?: string): void;
  remove(service: string, env?: string): void;
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
    /** The rows of `env`: where each is set there, never in another environment. */
    load(service: string, env?: string): Promise<VariableRow[]>;
    /** `done` runs once the value is kept in `env`: the rows are then looked up again. */
    set(row: VariableRow, env: string | undefined, done: () => void): void;
    /** Every variable the services of `env` send, where each is set there. */
    all(env?: string): Promise<VariableRow[]>;
    /** Asks, then removes the value `env` keeps in local.yml; `done` runs once it is gone. */
    remove(row: VariableRow, env: string | undefined, done: () => void): void;
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
}

/** The writes of the editing keys; undefined when the command line gave no writer. */
export function createEditor({
  view,
  editing,
  changed,
  redraw,
  declaredIn,
  tracker,
  createEnvironment,
  removeEnvironment,
}: EditorDeps): Editor {
  const { writeService, writeParameter, variables } = editing;

  /** The editing of config.yml, or of the file of `env`; says why when that file is not there to edit. */
  const target = (
    env: string | undefined,
    tell = true,
  ): { edits: Editing; env?: string } | undefined => {
    if (env === undefined || env === LOCAL_ENVIRONMENT) return { edits: editing };
    const edits = editing.environment?.(env);
    if (edits) return { edits, env };
    if (tell) say(view, `${env} is not read yet: try again in a moment`);
    return undefined;
  };

  /** Where the values of `env` are kept: local.yml, under its own key unless it is the top level. */
  const placeOf = (env?: string) => (env === undefined ? LOCAL : `${LOCAL}, under envs.${env}`);

  const writer =
    (edits: Editing, env?: string) =>
    async (change: ServiceWrite, done: string, secrets?: Secrets) => {
      const outcome = await edits.writeService?.(change, secrets);
      if (!outcome) return;
      view.unsaved = outcome.failure;
      if (outcome.saved) {
        const kept = Object.keys(secrets ?? {});
        const where = env === undefined ? LOCAL : `${LOCAL}, under envs.${env}`;
        const told =
          kept.length > 0 && outcome.failure === undefined
            ? `${done}, ${kept.join(", ")} kept in ${where}`
            : done;
        const notes = [outcome.warning ? `${told}\n${outcome.warning}` : told, outcome.failure];
        say(view, notes.filter(Boolean).join("\n"));
        if (change.kind === "remove" && env === undefined) {
          const { [change.name]: _, ...others } = view.timeouts;
          view.timeouts = others;
        }
        changed();
      } else if (outcome.failure) say(view, `not saved: ${outcome.failure}`);
      redraw();
    };

  const contextOf = (edits: Editing, env?: string) => ({
    editing: edits,
    stack: view.modals,
    redraw,
    write: writer(edits, env),
    target: env,
  });

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
    add(env) {
      const found = writeService && target(env);
      if (found) view.modals.push(serviceFormModal(contextOf(found.edits, found.env)));
    },
    edit(service, env) {
      const found = writeService && target(env);
      if (!found) return;
      if (!found.edits.serviceFields(service)) return say(view, notIn(service, found.env));
      view.modals.push(serviceFormModal(contextOf(found.edits, found.env), service));
    },
    remove(service, env) {
      const found = writeService && target(env);
      if (!found) return;
      if (!found.edits.config().services[service]) return say(view, notIn(service, found.env));
      const where = found.env === undefined ? "the config" : found.env;
      view.modals.push(
        confirmModal(
          `remove ${service}`,
          `Remove ${service} from ${where}?`,
          () =>
            void writer(found.edits, found.env)(
              { kind: "remove", name: service },
              `Removed ${service}`,
            ),
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
      // An environment not read yet has no rows: the local ones would say where a value is set for another file.
      load: async (service, env) =>
        (await target(env, false)?.edits.variables?.serviceVariables(service)) ?? [],
      all: async (env) => (await target(env, false)?.edits.variables?.allVariables()) ?? [],
      remove({ name, source }, env, done) {
        const found = target(env);
        const remove = found?.edits.removeVariable;
        if (!found || !remove) return;
        if (source === "environment")
          return say(view, `${name} comes from the environment: unset it there`);
        if (source === undefined) return say(view, `${name} has no value in ${LOCAL}`);
        const where = placeOf(found.env);
        view.modals.push(
          confirmModal(
            `remove ${name}`,
            `Remove the value of ${name} from ${where}?`,
            () =>
              void remove(name).then((failure) => {
                view.unsaved = failure;
                say(view, failure ? `not saved: ${failure}` : `Removed ${name} from ${where}`);
                if (!failure) {
                  changed();
                  done();
                }
                redraw();
              }),
          ),
        );
      },
      set({ name, source }, env, done) {
        const found = target(env);
        const write = found?.edits.writeVariable;
        if (!found || !write) return;
        if (source === "environment")
          return say(view, `${name} comes from the environment, which is read first`);
        const where = placeOf(found.env);
        view.modals.push(
          variableModal(name, (value) => {
            void write(name, value).then((failure) => {
              view.unsaved = failure;
              say(
                view,
                failure
                  ? `not saved: ${failure}`
                  : `Kept ${name} in ${where}, for this machine only`,
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
