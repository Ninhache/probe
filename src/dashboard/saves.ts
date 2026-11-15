export type Saved = Promise<string | undefined>;

export interface SaveQueue {
  // `write` resolving false means the file was left alone: `refusal` says why.
  save(file: string, write: () => Promise<boolean>, refusal: string): Saved;
  failures(): string[];
  idle(): Promise<void>;
}

function describe(file: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === "string") return `${file} cannot be written (${code})`;
  return (error instanceof Error ? error.message : String(error)).split("\n", 1)[0] ?? "";
}

/** Saves one at a time, never rejecting: a project that cannot be written must not break the dashboard. */
export function createSaveQueue(): SaveQueue {
  const failed = new Map<string, string>();
  let last: Promise<unknown> = Promise.resolve();
  return {
    save(file, write, refusal) {
      const done = last
        .then(write)
        .then(
          (saved) => (saved ? undefined : refusal),
          (error: unknown) => describe(file, error),
        )
        .then((failure) => {
          if (failure === undefined) failed.delete(file);
          else failed.set(file, failure);
          return failed.values().next().value;
        });
      last = done;
      return done;
    },
    failures: () => [...failed.values()],
    idle: async () => {
      await last;
    },
  };
}
