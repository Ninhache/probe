import type { Key as EngineKey } from "../tui/input";

export interface Keystroke {
  input: string;
  key?: "up" | "down" | "left" | "right" | "return" | "escape" | "backspace" | "tab" | "clear";
}

const ENGINE_NAMES: Record<string, Keystroke["key"]> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  enter: "return",
  escape: "escape",
  backspace: "backspace",
  tab: "tab",
};

/** An engine key event as the keystroke the form and chooser logic reads. */
export function fromEngineKey(event: EngineKey): Keystroke {
  if (event.ctrl && event.name === "u") return { input: "", key: "clear" };
  const key = event.ctrl || event.alt ? undefined : ENGINE_NAMES[event.name];
  if (key) return { input: "", key };
  const printable = !event.ctrl && !event.alt && event.name !== "space" && event.raw.length > 0;
  if (event.name === "space" && !event.ctrl && !event.alt) return { input: " " };
  return { input: printable && event.raw >= " " && event.raw !== "\x7f" ? event.raw : "" };
}
