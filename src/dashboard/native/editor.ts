import type { ServiceWrite } from "../../commands/service-writes";
import { LOCAL_FILE, PROBE_DIR } from "../../constants";
import type { Secrets } from "../Dashboard";
import type { Editing } from "../editing";
import { confirmModal } from "./confirm";
import type { Tracker } from "./history";
import { serviceFormModal } from "./service-form";
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
}

export interface EditorDeps {
  view: ViewState;
  tracker: Tracker;
  editing: Editing;
  /** The files changed: the services and parameters are read again and a pass starts. */
  changed(): void;
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
}: EditorDeps): Editor | undefined {
  const { writeService } = editing;
  if (!writeService) return undefined;

  const write = async (change: ServiceWrite, done: string, secrets?: Secrets) => {
    const outcome = await writeService(change, secrets);
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
    add: () => view.modals.push(serviceFormModal(context)),
    edit(service) {
      if (!editing.serviceFields(service)) return;
      view.modals.push(serviceFormModal(context, service));
    },
    remove(service) {
      if (!editing.config().services[service]) return;
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
  };
}
