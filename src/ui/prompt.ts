import type { Readable, Writable } from "node:stream";

export interface PromptStreams {
  input?: Readable;
  output?: Writable;
}

// "No" is selected first: Enter alone changes nothing.
export async function confirm(message: string, streams: PromptStreams = {}): Promise<boolean> {
  const { confirm: ask, isCancel } = await import("@clack/prompts");
  const answer = await ask({ message, initialValue: false, ...streams });
  return !isCancel(answer) && answer;
}

export interface Question {
  placeholder?: string;
  defaultValue?: string;
  validate?: (answer: string) => string | undefined;
}

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

export async function askSecret(
  message: string,
  validate: (answer: string) => string | undefined,
  streams: PromptStreams = {},
): Promise<string | null> {
  const { password, isCancel } = await import("@clack/prompts");
  const answer = await password({
    message,
    validate: (typed) => validate(typed ?? ""),
    ...streams,
  });
  return isCancel(answer) ? null : answer;
}

export interface Choice {
  label: string;
  hint?: string;
}

// Nothing is ticked first: Enter alone picks nothing.
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
