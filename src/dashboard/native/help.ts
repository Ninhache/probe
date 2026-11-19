import { registerHints } from "../../tui/hits";
import type { InputEvent } from "../../tui/input";
import type { Rect } from "../../tui/layout";
import type { Modal } from "../../tui/modal";
import type { Screen } from "../../tui/screen";
import { drawField, fieldKey, fieldValue, textField } from "../../tui/textfield";
import { defaultTheme as t } from "../../tui/theme";
import { strWidth } from "../../tui/width";
import {
  HELP_GAP,
  type HelpLine,
  type HelpPart,
  helpBarItems,
  helpColumns,
  helpLines,
  type Screen as KeymapScreen,
} from "../keymap";

/** The terminal draws every symbol the keymap can show. */
const UNICODE = true;
const BAR_MARGIN = 1;
const MODAL_MARGIN = 4;
const PADDING = 2;
const WHEEL_LINES = 3;

export interface BarContext {
  screen: KeymapScreen;
  grid: boolean;
  /** The selected config declares parameters: the bar then offers to change them. */
  parameters?: boolean;
}

const BAR_SEPARATOR = " · ";

/** The hint line: what the keymap offers on this screen, the key of each binding highlighted. */
export function drawHelpBar(
  screen: Screen,
  row: Rect,
  { screen: name, grid, parameters }: BarContext,
): void {
  const items = helpBarItems(name, UNICODE, Math.max(0, row.w - 2 * BAR_MARGIN), grid, parameters);
  let x = row.x + BAR_MARGIN;
  const end = row.x + row.w;
  items.forEach(({ keys, action }, i) => {
    if (i > 0) x += screen.text(x, row.y, BAR_SEPARATOR, { fg: t.muted }, end - x);
    registerHints(screen.hits, x, row.y, `${keys} ${action}`, end);
    x += screen.text(x, row.y, keys, { fg: t.accent, bold: true }, end - x);
    x += screen.text(x, row.y, ` ${action}`, { fg: t.muted }, end - x);
  });
}

interface HelpCell {
  text: string;
  heading: boolean;
  x: number;
  /** Where the keys end in `text`: the rest is the description. */
  keysEnd?: number;
  /** The rule between the keys of the screen and all the others. */
  divider?: boolean;
}

type HelpRow = { cells: HelpCell[]; width: number };

const DIVIDER = "── all keys (Tab) ──";

/** The lines of each column as rows: one list of cells per row. */
function rowsOf(columns: HelpLine[][]): HelpRow[] {
  const starts: number[] = [];
  let x = 0;
  for (const column of columns) {
    starts.push(x);
    x += Math.max(0, ...column.map(({ text }) => strWidth(text))) + HELP_GAP;
  }
  const count = Math.max(0, ...columns.map((column) => column.length));
  return Array.from({ length: count }, (_, i) => ({
    cells: columns.flatMap((column, c) => {
      const line = column[i];
      return line
        ? [{ text: line.text, heading: line.heading, x: starts[c] ?? 0, keysEnd: line.keysEnd }]
        : [];
    }),
    width: x - HELP_GAP,
  }));
}

/**
 * The help sections side by side when they fit, stacked otherwise.
 * `part` keeps the keys of `screen`, or the others.
 */
export function helpRows(
  width: number,
  grid: boolean,
  screen?: KeymapScreen,
  part: HelpPart = "all",
): HelpRow[] {
  return rowsOf(helpColumns(UNICODE, width, grid, screen, part));
}

const PROMPT = "search: ";

/** Whether a line of the help has `wanted` in its keys or its description, whichever way the keys are written. */
const matches = (texts: readonly (string | undefined)[], wanted: string) =>
  texts.some((text) => text?.toLowerCase().includes(wanted));

/**
 * The lines that match `query`, under the headings of their sections, in one column.
 * Both writings of the keys count: `↵` and `enter` find the same line.
 */
export function searchRows(query: string, grid: boolean): HelpRow[] {
  const wanted = query.trim().toLowerCase();
  const ascii = new Map(helpLines(false, grid).map(({ id, text }) => [id, text]));
  const kept: HelpLine[] = [];
  let heading: HelpLine | undefined;
  for (const line of helpLines(UNICODE, grid)) {
    if (line.heading) heading = line;
    else if (matches([line.text, ascii.get(line.id)], wanted)) {
      if (heading) kept.push(heading);
      heading = undefined;
      kept.push(line);
    }
  }
  return kept.map(({ text, heading: isHeading, keysEnd }) => ({
    cells: [{ text, heading: isHeading, x: 0, keysEnd }],
    width: strWidth(text),
  }));
}

/**
 * The help overlay: the keys of `screen` first, all the others under a rule that Tab opens.
 * Typing narrows every key, whatever the screen, to the lines that match; the letters are the
 * query, `q` included.
 */
export function helpModal(area: Rect, grid: boolean, screen: KeymapScreen = "list"): Modal {
  const maxWidth = Math.max(10, area.w - MODAL_MARGIN * 2);
  const inside = maxWidth - 2 * PADDING;
  const current = helpRows(inside, grid, screen, "current");
  const rest = helpRows(inside, grid, screen, "rest");
  const divider: HelpRow = {
    cells: [{ text: DIVIDER, heading: false, x: 0, divider: true }],
    width: strWidth(DIVIDER),
  };
  const folded = [...current, divider];
  const unfolded = [...folded, ...rest];
  const wanted = Math.max(...unfolded.map(({ width }) => width)) + 2 * PADDING;
  // A screen with no line of its own has nothing to put first.
  let expanded = current.length === 0;
  const everything = () => (expanded ? unfolded : folded);
  let query = textField();
  let top = 0;
  const lines = () =>
    fieldValue(query).trim() === "" ? everything() : searchRows(fieldValue(query), grid);
  // The first row of the box is the query: the lines scroll below it.
  const room = (inner: Rect) => Math.max(1, inner.h - 1);
  const clamp = (inner: Rect) => Math.max(0, Math.min(top, lines().length - room(inner)));
  const keyDelta = (name: string, page: number): number | undefined =>
    ({
      up: -1,
      down: 1,
      pageup: -page,
      pagedown: page,
      home: -lines().length,
      end: lines().length,
    })[name];
  return {
    title: "help",
    get footer() {
      return fieldValue(query) === "" ? "type to search · esc close" : "esc clear";
    },
    // Letters are typed: `q` is part of the query, it does not quit.
    typing: true,
    get size() {
      return { w: Math.min(wanted, maxWidth), h: everything().length + 3 };
    },
    draw(screen, inner) {
      const prompt = screen.text(inner.x + PADDING, inner.y, PROMPT, { fg: t.accent, bold: true });
      query = drawField(
        screen,
        inner.x + PADDING + prompt,
        inner.y,
        inner.w - prompt - 2 * PADDING,
        query,
        {
          fg: t.fg,
        },
      );
      const shown = lines();
      top = clamp(inner);
      if (shown.length === 0) {
        const text = `No key matches "${fieldValue(query).trim()}"`;
        screen.text(inner.x + PADDING, inner.y + 1, text, { fg: t.muted }, inner.w - PADDING);
        return;
      }
      for (let i = 0; i < room(inner); i++) {
        for (const cell of shown[top + i]?.cells ?? []) {
          const x = inner.x + PADDING + cell.x;
          const y = inner.y + 1 + i;
          if (cell.heading) screen.text(x, y, cell.text, { fg: t.accent, bold: true }, inner.w);
          else if (cell.keysEnd === undefined)
            screen.text(x, y, cell.text, { fg: t.muted }, inner.w);
          else {
            const keys = screen.text(
              x,
              y,
              cell.text.slice(0, cell.keysEnd),
              { fg: t.accent },
              inner.w,
            );
            screen.text(x + keys, y, cell.text.slice(cell.keysEnd), { fg: t.muted }, inner.w);
          }
        }
      }
    },
    onEvent(event: InputEvent, inner) {
      if (event.kind === "mouse") {
        if (event.action !== "wheel-up" && event.action !== "wheel-down") return true;
        top = clamp(inner) + (event.action === "wheel-up" ? -WHEEL_LINES : WHEEL_LINES);
        return true;
      }
      if (event.name === "escape" && !event.ctrl && !event.alt) {
        if (fieldValue(query) === "") return false;
        query = textField();
        top = 0;
        return true;
      }
      if (event.name === "?") return "close";
      if (event.name === "tab") {
        if (fieldValue(query) === "") {
          expanded = !expanded;
          top = 0;
        }
        return true;
      }
      const delta = keyDelta(event.name, Math.max(1, room(inner) - 1));
      if (delta !== undefined) {
        top = clamp(inner) + delta;
        return true;
      }
      const next = fieldKey(query, event);
      if (fieldValue(next) !== fieldValue(query)) top = 0;
      query = next;
      return true;
    },
  };
}
