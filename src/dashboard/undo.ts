import { readFile, rm, writeFile } from "node:fs/promises";
import type { ProbePaths } from "../config/discovery";
import { CONFIG_FILE, DEFAULT_MAKEFILE, LOCK_FILE, PROBE_DIR } from "../constants";
import { makefilePath } from "../makefile/sync";

/** A file the journal keeps: `label` is what a refusal names, never its content. */
export interface JournalFile {
  path: string;
  label: string;
}

export type UndoOutcome =
  | { kind: "undone"; label: string }
  | { kind: "empty" }
  | { kind: "changed"; file: string };

export interface UndoJournal {
  /** Runs `write`; when it resolves true and changed a file, `label` can be undone. `only` replaces the files watched for this step. */
  record(
    label: string,
    write: () => Promise<boolean>,
    only?: readonly JournalFile[],
  ): Promise<boolean>;
  /** Puts back the files as they were before the last write recorded, if nothing changed them since. */
  undo(): Promise<UndoOutcome>;
  /** Writes again what the last undo took back, if nothing changed the files since; a new write forgets it. */
  redo(): Promise<UndoOutcome>;
}

/** What a dashboard write changes. local.yml is left out: it holds secret values, and the journal copies what it keeps. */
export const journalFiles = (paths: ProbePaths): JournalFile[] => [
  { path: paths.config, label: `${PROBE_DIR}/${CONFIG_FILE}` },
  { path: paths.lock, label: `${PROBE_DIR}/${LOCK_FILE}` },
  { path: makefilePath(paths), label: DEFAULT_MAKEFILE },
];

// Each timeout step in the detail panel is one write: enough for a session, bounded in memory.
export const UNDO_LIMIT = 50;

interface Step {
  label: string;
  files: { file: JournalFile; before: string; after: string | null }[];
}

const put = (path: string, text: string | null) =>
  text === null ? rm(path, { force: true }) : writeFile(path, text);

const contents = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/**
 * An in-memory undo stack over `files`. Only files without secrets go in it: it copies them whole.
 * A file the write created is left in place by an undo.
 */
export function createUndoJournal(
  files: readonly JournalFile[],
  limit: number = UNDO_LIMIT,
): UndoJournal {
  const steps: Step[] = [];
  const undone: Step[] = [];
  // All or nothing: a file changed elsewhere since leaves every file of the step as it is.
  const move = async (from: Step[], to: Step[], back: boolean): Promise<UndoOutcome> => {
    const step = from.at(-1);
    if (!step) return { kind: "empty" };
    for (const { file, before, after } of step.files) {
      if ((await contents(file.path)) !== (back ? after : before))
        return { kind: "changed", file: file.label };
    }
    for (const { file, before, after } of step.files) await put(file.path, back ? before : after);
    from.pop();
    to.push(step);
    return { kind: "undone", label: step.label };
  };
  const read = (watched: readonly JournalFile[]) =>
    Promise.all(watched.map(({ path }) => contents(path)));
  return {
    async record(label, write, only = files) {
      const before = await read(only);
      const written = await write();
      if (!written) return written;
      const after = await read(only);
      const changed = only.flatMap((file, index) => {
        const was = before[index];
        const now = after[index] ?? null;
        return was === null || was === undefined || was === now
          ? []
          : [{ file, before: was, after: now }];
      });
      if (changed.length > 0) {
        steps.push({ label, files: changed });
        undone.length = 0;
      }
      if (steps.length > limit) steps.shift();
      return written;
    },
    undo: () => move(steps, undone, true),
    redo: () => move(undone, steps, false),
  };
}
