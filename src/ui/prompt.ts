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
