import type { Readable, Writable } from "node:stream";

export interface PromptStreams {
  input?: Readable;
  output?: Writable;
}

const YES = "Yes";
const NO = "No";
const TOWARDS_YES = ["left", "up"];
const TOWARDS_NO = ["right", "down"];

// "No" is selected first: Enter alone changes nothing.
export async function confirm(message: string, streams: PromptStreams = {}): Promise<boolean> {
  const { ConfirmPrompt } = await import("@clack/core");
  const { isCancel, symbol, S_BAR, S_BAR_END, S_RADIO_ACTIVE, S_RADIO_INACTIVE } = await import(
    "@clack/prompts"
  );
  const { styleText } = await import("node:util");
  const option = (label: string, picked: boolean) =>
    picked
      ? `${styleText("green", S_RADIO_ACTIVE)} ${label}`
      : styleText("dim", `${S_RADIO_INACTIVE} ${label}`);
  const prompt = new ConfirmPrompt({
    active: YES,
    inactive: NO,
    initialValue: false,
    ...streams,
    render() {
      const title = `${styleText("gray", S_BAR)}\n${symbol(this.state)}  ${message}\n`;
      const answer = this.value ? YES : NO;
      if (this.state === "submit")
        return `${title}${styleText("gray", S_BAR)}  ${styleText("dim", answer)}`;
      if (this.state === "cancel") {
        const struck = styleText(["strikethrough", "dim"], answer);
        return `${title}${styleText("gray", S_BAR)}  ${struck}\n${styleText("gray", S_BAR)}`;
      }
      const options = `${option(YES, this.value === true)} ${styleText("dim", "/")} ${option(NO, this.value !== true)}`;
      return `${title}${styleText("cyan", S_BAR)}  ${options}\n${styleText("cyan", S_BAR_END)}\n`;
    },
  });
  // The library flips the answer on any arrow: the right one, pressed on "No", would say "Yes".
  // This runs after its flip and sets the side the key points to.
  prompt.on("cursor", (direction) => {
    if (direction && TOWARDS_YES.includes(direction)) prompt.value = true;
    if (direction && TOWARDS_NO.includes(direction)) prompt.value = false;
  });
  const answer = await prompt.prompt();
  return !isCancel(answer) && answer === true;
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
