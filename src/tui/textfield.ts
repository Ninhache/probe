import type { Key } from "./input";
import type { Screen, Style } from "./screen";
import { charWidth, graphemes } from "./width";

/** Pure state of a one-line editor: graphemes, caret between two of them, first visible one. */
export type TextField = {
  chars: readonly string[];
  /** Caret position, 0..chars.length: it sits before chars[cursor]. */
  cursor: number;
  /** Index of the first visible grapheme. Kept up to date by renderField. */
  offset: number;
  /** Shown in place of every grapheme, for secret values. */
  mask?: string;
};

export const textField = (value = "", mask?: string): TextField => ({
  chars: graphemes(stripControls(value)),
  cursor: graphemes(stripControls(value)).length,
  offset: 0,
  mask,
});

export const fieldValue = (f: TextField): string => f.chars.join("");

// biome-ignore lint/suspicious/noControlCharactersInRegex: a paste can carry newlines and escapes
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const stripControls = (text: string): string => text.replace(CONTROLS, "");

const isSpace = (g: string | undefined): boolean => g === " " || g === "\t";

function wordStart(chars: readonly string[], from: number): number {
  let i = from;
  while (i > 0 && isSpace(chars[i - 1])) i--;
  while (i > 0 && !isSpace(chars[i - 1])) i--;
  return i;
}

function wordEnd(chars: readonly string[], from: number): number {
  let i = from;
  while (i < chars.length && isSpace(chars[i])) i++;
  while (i < chars.length && !isSpace(chars[i])) i++;
  return i;
}

const splice = (f: TextField, start: number, end: number, insert: string[] = []): TextField => ({
  ...f,
  chars: [...f.chars.slice(0, start), ...insert, ...f.chars.slice(end)],
  cursor: start + insert.length,
});

/** Insert text at the caret. Newlines and other control characters in a paste are dropped. */
export function insertText(f: TextField, text: string): TextField {
  const added = graphemes(stripControls(text));
  return added.length === 0 ? f : splice(f, f.cursor, f.cursor, added);
}

/**
 * Apply one key. Returns the same object when the key is not an editing key, so the caller can
 * tell that Enter, Esc, up/down... are still its own to handle.
 */
export function fieldKey(f: TextField, k: Key): TextField {
  const jump = k.ctrl || k.alt;
  switch (k.name) {
    case "left":
      return { ...f, cursor: jump ? wordStart(f.chars, f.cursor) : Math.max(0, f.cursor - 1) };
    case "right":
      return {
        ...f,
        cursor: jump ? wordEnd(f.chars, f.cursor) : Math.min(f.chars.length, f.cursor + 1),
      };
    case "home":
      return { ...f, cursor: 0 };
    case "end":
      return { ...f, cursor: f.chars.length };
    case "backspace":
      if (jump) return splice(f, wordStart(f.chars, f.cursor), f.cursor);
      return f.cursor === 0 ? f : splice(f, f.cursor - 1, f.cursor);
    case "delete":
      return f.cursor >= f.chars.length ? f : splice(f, f.cursor, f.cursor + 1);
    case "space":
      if (!k.ctrl && !k.alt) return insertText(f, " ");
      return f;
    default:
  }
  if (k.ctrl) {
    switch (k.name) {
      case "a":
        return { ...f, cursor: 0 };
      case "e":
        return { ...f, cursor: f.chars.length };
      case "b":
        return { ...f, cursor: Math.max(0, f.cursor - 1) };
      case "f":
        return { ...f, cursor: Math.min(f.chars.length, f.cursor + 1) };
      case "u":
        return { ...f, chars: [], cursor: 0, offset: 0 };
      case "k":
        return splice(f, f.cursor, f.chars.length);
      case "w":
        return splice(f, wordStart(f.chars, f.cursor), f.cursor);
      default:
        return f;
    }
  }
  if (k.alt) {
    if (k.name === "b") return { ...f, cursor: wordStart(f.chars, f.cursor) };
    if (k.name === "f") return { ...f, cursor: wordEnd(f.chars, f.cursor) };
    if (k.name === "d") return splice(f, f.cursor, wordEnd(f.chars, f.cursor));
    return f;
  }
  const typed = graphemes(k.raw);
  if (typed.length === 1 && stripControls(k.raw) === k.raw && !k.raw.startsWith("\x1b"))
    return insertText(f, k.raw);
  return f;
}

const cellWidth = (f: TextField, g: string | undefined): number =>
  g === undefined ? 1 : f.mask ? 1 : charWidth(g) || 1;

/** Scroll the window just enough to keep the caret, and one column for it, inside `width`. */
export function fitField(f: TextField, width: number): TextField {
  let offset = Math.min(f.offset, f.cursor);
  const used = (from: number): number => {
    let w = cellWidth(f, f.chars[f.cursor]);
    for (let i = from; i < f.cursor; i++) w += cellWidth(f, f.chars[i]);
    return w;
  };
  while (offset < f.cursor && used(offset) > width) offset++;
  return offset === f.offset ? f : { ...f, offset };
}

export type FieldView = {
  /** One entry per column; the second half of a wide character is "". */
  cells: string[];
  /** Column of the caret within `cells`. */
  caret: number;
  /** The field with its scroll offset updated; keep it for the next frame. */
  state: TextField;
};

/** What to draw in `width` columns: the visible slice, the caret column and the scrolled state. */
export function renderField(f: TextField, width: number): FieldView {
  const state = fitField(f, width);
  const cells: string[] = [];
  let caret = 0;
  for (let i = state.offset; i < state.chars.length; i++) {
    if (i === state.cursor) caret = cells.length;
    const g = state.chars[i] as string;
    const shown = state.mask ?? g;
    const w = state.mask ? 1 : cellWidth(state, g);
    if (cells.length + w > width) break;
    cells.push(shown);
    if (w === 2) cells.push("");
  }
  if (state.cursor >= state.chars.length) caret = cells.length;
  return { cells, caret: Math.min(caret, Math.max(0, width - 1)), state };
}

/** Draw the field on one row, the caret as an inverse cell. Returns the scrolled state. */
export function drawField(
  screen: Screen,
  x: number,
  y: number,
  width: number,
  f: TextField,
  style: Style,
  focused = true,
): TextField {
  if (width <= 0) return f;
  const view = renderField(f, width);
  view.cells.forEach((cell, i) => {
    if (cell !== "") screen.set(x + i, y, cell, style);
  });
  if (focused) {
    const under = view.cells[view.caret] || " ";
    screen.set(x + view.caret, y, under, { ...style, inverse: true });
  }
  return view.state;
}
