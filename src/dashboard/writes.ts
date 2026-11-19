import { environmentFile } from "../commands/env-create";
import { ignoreLocalFiles } from "../commands/init";
import {
  type ParameterWrite,
  type ParameterWritten,
  writeParameter,
} from "../commands/parameter-writes";
import { type ServiceWrite, type ServiceWritten, writeService } from "../commands/service-writes";
import type { ProbePaths } from "../config/discovery";
import { environmentPaths } from "../config/environments";
import { loadConfig, writeServiceTimeout } from "../config/loader";
import {
  changedPreferences,
  loadVariables,
  readLocalVariables,
  variableSource,
  writeDashboardPreferences,
  writeDashboardSelection,
  writeServiceSkip,
  writeVariable,
} from "../config/local";
import { CONFIG_FILE, LOCAL_FILE, PROBE_DIR } from "../constants";
import type { Secrets } from "./editing";
import { createSaveQueue } from "./saves";
import type { DashboardSettings } from "./settings";
import { createUndoJournal, journalFiles, type UndoOutcome } from "./undo";

/** What the dashboard writes: every save goes through one queue and one undo journal. */
export function dashboardWrites(paths: ProbePaths, initial: DashboardSettings) {
  let settings = initial;
  const saves = createSaveQueue();
  const local = `${PROBE_DIR}/${LOCAL_FILE}`;
  const saveLocal = (write: () => Promise<boolean>) =>
    saves.save(local, write, `${local} cannot be edited safely: fix or delete it`);
  const configFile = `${PROBE_DIR}/${CONFIG_FILE}`;
  const journal = createUndoJournal(journalFiles(paths));
  const revert = async (way: "undo" | "redo") => {
    const word = way === "undo" ? "undone" : "redone";
    let outcome = { kind: "empty" } as UndoOutcome;
    const failure = await saves.save(
      configFile,
      async () => {
        outcome = await journal[way]();
        return true;
      },
      "",
    );
    if (failure) return { failure };
    if (outcome.kind === "empty") return { failure: `Nothing to ${way}` };
    if (outcome.kind === "changed")
      return { failure: `${outcome.file} changed since: nothing ${word}` };
    // Not on stderr: a line printed there would land in the middle of the screen.
    const { config } = await loadConfig(paths, { log: () => {} });
    return { config, undone: `${word[0]?.toUpperCase()}${word.slice(1)}: ${outcome.label}` };
  };
  const keepVariable = async (target: ProbePaths, name: string, value: string) => {
    // Before the value is written: the file that holds it must never be committed.
    await ignoreLocalFiles(paths.root);
    return writeVariable(target, name, value);
  };
  return {
    saves,
    writes: {
      onParameterChange: (name: string, value: string) =>
        saveLocal(() => writeDashboardSelection(paths, name, value)),
      variables: () => loadVariables(paths),
      variableSources: async (names: readonly string[], env?: string) => {
        const { values } = await readLocalVariables(await environmentPaths(paths, env));
        return Object.fromEntries(
          names.map((name) => [name, variableSource(name, values, process.env)]),
        );
      },
      onVariableWrite: async (name: string, value: string, env?: string) => {
        let target = paths;
        try {
          target = await environmentPaths(paths, env);
        } catch (error) {
          return (error as Error).message;
        }
        return saveLocal(() => keepVariable(target, name, value));
      },
      onSettingsChange: (next: DashboardSettings) => {
        const changed = changedPreferences(settings, next);
        settings = next;
        return saveLocal(() => writeDashboardPreferences(paths, changed));
      },
      onSkipChange: (name: string, skip: boolean) =>
        saveLocal(() => writeServiceSkip(paths, name, skip)),
      onTimeoutChange: (name: string, seconds: number | undefined) =>
        saves.save(
          `${PROBE_DIR}/${CONFIG_FILE}`,
          () =>
            journal.record(`timeout of ${name}`, () => writeServiceTimeout(paths, name, seconds)),
          `${name} is no longer in ${PROBE_DIR}/${CONFIG_FILE}`,
        ),
      onServiceWrite: async (write: ServiceWrite, secrets: Secrets = {}) => {
        let target = paths;
        try {
          target = await environmentPaths(paths, write.env);
        } catch (error) {
          return { failure: (error as Error).message };
        }
        // An environment file is its own file: the Makefile and the lock stay out of its undo step.
        const file = write.env === undefined ? configFile : environmentFile(write.env);
        let written: ServiceWritten | null = null;
        let failure = await saves.save(
          file,
          () =>
            journal.record(
              `${write.kind} ${write.name}`,
              async () => {
                written = await writeService(target, write);
                return written !== null;
              },
              journalFiles(target),
            ),
          write.kind === "add"
            ? `${write.name} is already in ${file}`
            : `${write.name} is no longer in ${file}`,
        );
        // After the config: a service that was not written leaves no secret behind.
        for (const [name, value] of written ? Object.entries(secrets) : [])
          failure = (await saveLocal(() => keepVariable(target, name, value))) ?? failure;
        return { failure, ...(written as ServiceWritten | null) };
      },
      onParameterWrite: async (write: ParameterWrite) => {
        let written: ParameterWritten | null = null;
        const failure = await saves.save(
          `${PROBE_DIR}/${CONFIG_FILE}`,
          () =>
            journal.record(`${write.kind} parameter ${write.name}`, async () => {
              written = await writeParameter(paths, write);
              return written !== null;
            }),
          write.kind === "add"
            ? `${write.name} is already in ${PROBE_DIR}/${CONFIG_FILE}`
            : `${write.name} is no longer in ${PROBE_DIR}/${CONFIG_FILE}`,
        );
        return { failure, ...(written as ParameterWritten | null) };
      },
      onUndo: () => revert("undo"),
      onRedo: () => revert("redo"),
    },
  };
}
