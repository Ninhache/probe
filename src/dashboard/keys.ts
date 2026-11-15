import type { Key } from "ink";

export interface Keystroke {
  input: string;
  key?: "up" | "down" | "left" | "right" | "return" | "escape" | "backspace" | "tab";
}

const ESCAPE = String.fromCharCode(27);
const DELETE = String.fromCharCode(127);
const ARROWS: Record<string, Keystroke["key"]> = { A: "up", B: "down", C: "right", D: "left" };
const KEY_PATTERN = new RegExp(`${ESCAPE}\\[([ABCD])|[\\s\\S]`, "g");

function named(key: Key): Keystroke["key"] {
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.return) return "return";
  if (key.escape) return "escape";
  // Terminals send DEL for the backspace key: ink calls it `delete`.
  if (key.backspace || key.delete) return "backspace";
  if (key.tab) return "tab";
  return undefined;
}

export function typedCharacter({ input, key }: Keystroke): string | undefined {
  return key === undefined && input.length === 1 && input >= " " && input !== DELETE
    ? input
    : undefined;
}

// Keys read in one go (typed fast, key repeat over a slow link) arrive as one string with no named key.
export function splitKeys(input: string, key: Key): Keystroke[] {
  const name = named(key);
  if (name || input.length <= 1) return [{ input, key: name }];
  return [...input.matchAll(KEY_PATTERN)].map(([text, arrow]) => {
    if (arrow) return { input: "", key: ARROWS[arrow] };
    if (text === "\r" || text === "\n") return { input: "", key: "return" };
    if (text === ESCAPE) return { input: "", key: "escape" };
    if (text === DELETE || text === "\b") return { input: "", key: "backspace" };
    if (text === "\t") return { input: "", key: "tab" };
    return { input: text };
  });
}
