import type { Key as EngineKey } from "../tui/input";

/** The part of ink's `Key` read here: ink stays assignable without being imported. */
export interface KeyFlags {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  ctrl?: boolean;
}

export interface Keystroke {
  input: string;
  key?: "up" | "down" | "left" | "right" | "return" | "escape" | "backspace" | "tab" | "clear";
}

const ESCAPE = String.fromCharCode(27);
const DELETE = String.fromCharCode(127);
const CONTROL_U = String.fromCharCode(21);
const ARROWS: Record<string, Keystroke["key"]> = { A: "up", B: "down", C: "right", D: "left" };
const KEY_PATTERN = new RegExp(`${ESCAPE}\\[([ABCD])|[\\s\\S]`, "g");

function named(input: string, key: KeyFlags): Keystroke["key"] {
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.return) return "return";
  if (key.escape) return "escape";
  // Terminals send DEL for the backspace key: ink calls it `delete`.
  if (key.backspace || key.delete) return "backspace";
  if (key.tab) return "tab";
  if (input === CONTROL_U || (key.ctrl && input === "u")) return "clear";
  return undefined;
}

export function typedCharacter({ input, key }: Keystroke): string | undefined {
  return key === undefined && input.length === 1 && input >= " " && input !== DELETE
    ? input
    : undefined;
}

// Keys read in one go (typed fast, key repeat over a slow link) arrive as one string with no named key.
export function splitKeys(input: string, key: KeyFlags): Keystroke[] {
  const name = named(input, key);
  if (name || input.length <= 1) return [{ input, key: name }];
  return [...input.matchAll(KEY_PATTERN)].map(([text, arrow]) => {
    if (arrow) return { input: "", key: ARROWS[arrow] };
    if (text === "\r" || text === "\n") return { input: "", key: "return" };
    if (text === ESCAPE) return { input: "", key: "escape" };
    if (text === DELETE || text === "\b") return { input: "", key: "backspace" };
    if (text === "\t") return { input: "", key: "tab" };
    if (text === CONTROL_U) return { input: "", key: "clear" };
    return { input: text };
  });
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

/** An engine key event as the same keystroke the ink screen produces, so shared logic reads both. */
export function fromEngineKey(event: EngineKey): Keystroke {
  if (event.ctrl && event.name === "u") return { input: "", key: "clear" };
  const key = event.ctrl || event.alt ? undefined : ENGINE_NAMES[event.name];
  if (key) return { input: "", key };
  const printable = !event.ctrl && !event.alt && event.name !== "space" && event.raw.length > 0;
  if (event.name === "space" && !event.ctrl && !event.alt) return { input: " " };
  return { input: printable && event.raw >= " " && event.raw !== "\x7f" ? event.raw : "" };
}
