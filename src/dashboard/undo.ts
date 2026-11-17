import { readFile, writeFile } from "node:fs/promises";
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
  /** Runs `write`; when it resolves true and changed a file, `label` can be undone. */
  record(label: string, write: () => Promise<boolean>): Promise<boolean>;
  /** Puts back the files as they were before the last write recorded, if nothing changed them since. */
  undo(): Promise<UndoOutcome>;
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
  const read = () => Promise.all(files.map(({ path }) => contents(path)));
  return {
    async record(label, write) {
      const before = await read();
      const written = await write();
      if (!written) return written;
      const after = await read();
      const changed = files.flatMap((file, index) => {
        const was = before[index];
        const now = after[index] ?? null;
        return was === null || was === undefined || was === now
          ? []
          : [{ file, before: was, after: now }];
      });
      if (changed.length > 0) steps.push({ label, files: changed });
      if (steps.length > limit) steps.shift();
      return written;
    },
    async undo() {
      const step = steps.at(-1);
      if (!step) return { kind: "empty" };
      // All or nothing: a file changed elsewhere since leaves every file of the step as it is.
      for (const { file, after } of step.files) {
        if ((await contents(file.path)) !== after) return { kind: "changed", file: file.label };
      }
      for (const { file, before } of step.files) await writeFile(file.path, before);
      steps.pop();
      return { kind: "undone", label: step.label };
    },
  };
}
