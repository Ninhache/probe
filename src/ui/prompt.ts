import type { Readable, Writable } from "node:stream";

/** Where a question is read and drawn; the process terminal when left out. */
export interface PromptStreams {
  input?: Readable;
  output?: Writable;
}

/**
 * Asks a yes/no question on the terminal. "No" is selected first: Enter alone changes nothing.
 * The prompt library is imported here only, so commands that ask nothing start without it.
 * @param message the question, e.g. `Remove api?`
 * @param streams streams to use instead of the process terminal
 * @returns true only for an explicit yes; false when declined or cancelled (Ctrl+C, Escape)
 */
export async function confirm(message: string, streams: PromptStreams = {}): Promise<boolean> {
  const { confirm: ask, isCancel } = await import("@clack/prompts");
  const answer = await ask({ message, initialValue: false, ...streams });
  return !isCancel(answer) && answer;
}

/** What a free-text question shows and accepts. */
export interface Question {
  /** Greyed example shown while nothing is typed. */
  placeholder?: string;
  /** Answer used when Enter is pressed alone; it is not validated. */
  defaultValue?: string;
  /** Returns what is wrong with the answer, or undefined to accept it. */
  validate?: (answer: string) => string | undefined;
}

/**
 * Asks for one line of text on the terminal, again until `validate` accepts it.
 * @param message the question, e.g. `Port`
 * @param question placeholder, default answer and validation
 * @param streams streams to use instead of the process terminal
 * @returns the answer, or null when cancelled (Ctrl+C, Escape)
 */
export async function ask(
  message: string,
  question: Question = {},
  streams: PromptStreams = {},
): Promise<string | null> {
  const { text, isCancel } = await import("@clack/prompts");
  const { placeholder, defaultValue, validate } = question;
  const answer = await text({
    message,
    placeholder,
    defaultValue,
    validate: (typed) => {
      const value = typed ?? "";
      return value === "" && defaultValue !== undefined ? undefined : validate?.(value);
    },
    ...streams,
  });
  if (isCancel(answer)) return null;
  return answer || (defaultValue ?? "");
}

/** One line of a checklist. */
export interface Choice {
  label: string;
  /** Shown dimmed next to the label of the line the cursor is on. */
  hint?: string;
}

/**
 * Shows a checklist on the terminal. Nothing is ticked first: Enter alone picks nothing.
 * @param message the question above the list
 * @param choices the lines, in order
 * @param streams streams to use instead of the process terminal
 * @returns the indexes of the ticked lines, or null when cancelled (Ctrl+C, Escape)
 */
export async function choose(
  message: string,
  choices: Choice[],
  streams: PromptStreams = {},
): Promise<number[] | null> {
  const { multiselect, isCancel } = await import("@clack/prompts");
  const options = choices.map((choice, value) => ({ value, ...choice }));
  const picked = await multiselect({ message, options, required: false, ...streams });
  return isCancel(picked) ? null : picked;
}
