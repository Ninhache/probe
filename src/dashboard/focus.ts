const ESCAPE = "\u001b";
const REPORT_ON = `${ESCAPE}[?1004h`;
const REPORT_OFF = `${ESCAPE}[?1004l`;
const FOCUS_IN = `${ESCAPE}[I`;
const FOCUS_OUT = `${ESCAPE}[O`;

export interface FocusInput {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface FocusWatch {
  /** Undefined until the terminal says it: some never do. */
  focused(): boolean | undefined;
  stop(): void;
}

/**
 * Asks the terminal to say when its window gains or loses the focus.
 * It only listens: what is typed still goes to whoever reads `input`.
 */
export function watchFocus(
  input: FocusInput,
  output: { write(text: string): unknown },
): FocusWatch {
  let focused: boolean | undefined;
  let stopped = false;
  const listen = (chunk: Buffer | string) => {
    const text = String(chunk);
    const gained = text.lastIndexOf(FOCUS_IN);
    const lost = text.lastIndexOf(FOCUS_OUT);
    if (gained !== lost) focused = gained > lost;
  };
  input.on("data", listen);
  output.write(REPORT_ON);
  return {
    focused: () => focused,
    stop() {
      if (stopped) return;
      stopped = true;
      input.off("data", listen);
      // Left on, the shell would print ^[[I at each change of window.
      output.write(REPORT_OFF);
    },
  };
}
