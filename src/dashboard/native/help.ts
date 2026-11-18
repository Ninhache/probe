import type { InputEvent } from "../../tui/input";
import type { Rect } from "../../tui/layout";
import type { Modal } from "../../tui/modal";
import type { Screen } from "../../tui/screen";
import { defaultTheme as t } from "../../tui/theme";
import { strWidth } from "../../tui/width";
import { HELP_GAP, helpBarItems, helpColumns, type Screen as KeymapScreen } from "../keymap";

/** The terminal draws every symbol the keymap can show; the ascii fallback is for the ink screen. */
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
    x += screen.text(x, row.y, keys, { fg: t.accent, bold: true }, end - x);
    x += screen.text(x, row.y, ` ${action}`, { fg: t.muted }, end - x);
  });
}

interface HelpCell {
  text: string;
  heading: boolean;
  x: number;
}

/** The help sections side by side when they fit, stacked otherwise: one list of cells per row. */
export function helpRows(width: number, grid: boolean): { cells: HelpCell[]; width: number }[] {
  const columns = helpColumns(UNICODE, width, grid);
  const starts: number[] = [];
  let x = 0;
  for (const column of columns) {
    starts.push(x);
    x += Math.max(0, ...column.map(({ text }) => strWidth(text))) + HELP_GAP;
  }
  const count = Math.max(...columns.map((column) => column.length));
  return Array.from({ length: count }, (_, i) => ({
    cells: columns.flatMap((column, c) => {
      const line = column[i];
      return line ? [{ text: line.text, heading: line.heading, x: starts[c] ?? 0 }] : [];
    }),
    width: x - HELP_GAP,
  }));
}

/** The help overlay: every binding by section, scrollable when the terminal is short. */
export function helpModal(area: Rect, grid: boolean): Modal {
  const maxWidth = Math.max(10, area.w - MODAL_MARGIN * 2);
  const lines = helpRows(maxWidth - 2 * PADDING, grid);
  const wanted = Math.max(...lines.map(({ width }) => width)) + 2 * PADDING;
  let top = 0;
  const clamp = (inner: Rect) => Math.max(0, Math.min(top, lines.length - inner.h));
  const keyDelta = (name: string, page: number): number | undefined =>
    ({
      up: -1,
      k: -1,
      down: 1,
      j: 1,
      pageup: -page,
      pagedown: page,
      home: -lines.length,
      end: lines.length,
    })[name];
  return {
    title: "help",
    footer: "esc close",
    size: { w: Math.min(wanted, maxWidth), h: lines.length + 2 },
    draw(screen, inner) {
      top = clamp(inner);
      for (let i = 0; i < inner.h; i++) {
        for (const cell of lines[top + i]?.cells ?? []) {
          const style = cell.heading ? { fg: t.accent, bold: true } : { fg: t.fg };
          screen.text(inner.x + PADDING + cell.x, inner.y + i, cell.text, style, inner.w);
        }
      }
    },
    onEvent(event: InputEvent, inner) {
      if (event.kind === "mouse") {
        if (event.action !== "wheel-up" && event.action !== "wheel-down") return true;
        top = clamp(inner) + (event.action === "wheel-up" ? -WHEEL_LINES : WHEEL_LINES);
        return true;
      }
      if (event.name === "?") return "close";
      const delta = keyDelta(event.name, Math.max(1, inner.h - 1));
      if (delta === undefined) return false;
      top = clamp(inner) + delta;
      return true;
    },
  };
}
