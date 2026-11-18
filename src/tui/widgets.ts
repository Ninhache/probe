import { at, type RGB } from "./color";
import { inset, type Rect, resolveSizes, type Size } from "./layout";
import type { Screen, Style } from "./screen";
import { pad } from "./width";

// ── Box ────────────────────────────────────────────────────────────────────────────────

export const BORDERS = {
  rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", l: "┤", r: "├" },
  square: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", l: "┤", r: "├" },
  heavy: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃", l: "┫", r: "┣" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║", l: "╡", r: "╞" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", l: "[", r: "]" },
} as const;

export type BoxOptions = {
  title?: string;
  /** Short label before the title, like btop's ¹²³ box numbers. Typically the box's hotkey. */
  hotkey?: string;
  /** Text on the bottom border. */
  footer?: string;
  border?: keyof typeof BORDERS;
  color?: RGB;
  titleColor?: RGB;
  hotkeyColor?: RGB;
};

/** Draw a frame with an inline title (btop: createBox). Returns the inner area. */
export function box(screen: Screen, r: Rect, o: BoxOptions = {}): Rect {
  if (r.w < 2 || r.h < 2) return { ...r, w: 0, h: 0 };
  const b = BORDERS[o.border ?? "rounded"];
  const line: Style = { fg: o.color };
  const right = r.x + r.w - 1;
  const bottom = r.y + r.h - 1;
  for (let x = r.x + 1; x < right; x++) {
    screen.set(x, r.y, b.h, line);
    screen.set(x, bottom, b.h, line);
  }
  for (let y = r.y + 1; y < bottom; y++) {
    screen.set(r.x, y, b.v, line);
    screen.set(right, y, b.v, line);
  }
  screen.set(r.x, r.y, b.tl, line);
  screen.set(right, r.y, b.tr, line);
  screen.set(r.x, bottom, b.bl, line);
  screen.set(right, bottom, b.br, line);

  const label = (y: number, text: string, hotkey?: string): void => {
    const room = r.w - 6; // 2 corners + 2 brackets + 1 space on each side
    if (room < 1) return;
    let x = r.x + 2;
    screen.set(x++, y, b.l, line);
    if (hotkey) x += screen.text(x, y, hotkey, { fg: o.hotkeyColor, bold: true }, room);
    x += screen.text(x, y, text, { fg: o.titleColor, bold: true }, room - (x - r.x - 3));
    screen.set(x, y, b.r, line);
  };
  if (o.title) label(r.y, o.title, o.hotkey);
  if (o.footer && r.h > 2) label(bottom, o.footer);
  return inset(r, 1);
}

// ── Meter (horizontal bar) ───────────────────────────────────────────────────────────────

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export type MeterOptions = {
  gradient: RGB[];
  bg?: RGB;
  /** "squares" = btop's ■■■■ look, "blocks" = smooth bar with 1/8-cell precision. */
  look?: "squares" | "blocks";
};

/** A bar filled to `ratio` (0..1). Each cell gets the gradient color for its position. */
export function meter(
  screen: Screen,
  x: number,
  y: number,
  width: number,
  ratio: number,
  o: MeterOptions,
): void {
  const r = Math.min(1, Math.max(0, ratio));
  const colorAt = (i: number): RGB => at(o.gradient, width > 1 ? i / (width - 1) : 1);
  if ((o.look ?? "squares") === "squares") {
    const filled = Math.round(r * width);
    for (let i = 0; i < width; i++)
      screen.set(x + i, y, "■", { fg: i < filled ? colorAt(i) : o.bg });
    return;
  }
  const eighths = Math.round(r * width * 8);
  for (let i = 0; i < width; i++) {
    const n = Math.min(8, Math.max(0, eighths - i * 8));
    const ch = n === 8 ? "█" : n > 0 ? EIGHTHS[n] : " ";
    screen.set(x + i, y, ch, { fg: colorAt(i), bg: o.bg });
  }
}

// ── Braille graph (btop's CPU/net graphs) ────────────────────────────────────────────────

/** One braille cell = 2 columns × 4 rows of dots. Dot bits listed from the bottom row up. */
const LEFT_DOTS = [0x40, 0x04, 0x02, 0x01];
const RIGHT_DOTS = [0x80, 0x20, 0x10, 0x08];
const BRAILLE_BASE = 0x2800;

export type GraphOptions = {
  /** Value at the top of the graph. Defaults to the max of the visible data. */
  max?: number;
  /** Colored by height: bottom = gradient[0], top = gradient[100]. */
  gradient: RGB[];
};

/**
 * Filled area graph, 2 samples per column, 4 levels per row: a 10-row box shows 40 levels.
 * The newest sample is on the right; older ones scroll off the left.
 */
export function graph(screen: Screen, r: Rect, data: readonly number[], o: GraphOptions): void {
  if (r.w <= 0 || r.h <= 0) return;
  const cap = r.w * 2;
  const samples = data.slice(-cap);
  const offset = cap - samples.length; // empty space on the left until history fills up
  const max = o.max ?? Math.max(1e-9, ...samples);
  const levels = r.h * 4;
  const level = (i: number): number => {
    const v = samples[i - offset];
    if (v === undefined || v <= 0) return 0;
    return Math.max(1, Math.round(Math.min(1, v / max) * levels)); // non-zero is always visible
  };
  for (let col = 0; col < r.w; col++) {
    const la = level(col * 2);
    const lb = level(col * 2 + 1);
    for (let row = 0; row < r.h; row++) {
      const fromBottom = r.h - 1 - row;
      const base = fromBottom * 4;
      let bits = 0;
      for (let d = 0; d < 4; d++) {
        if (la > base + d) bits |= LEFT_DOTS[d];
        if (lb > base + d) bits |= RIGHT_DOTS[d];
      }
      const ch = bits ? String.fromCharCode(BRAILLE_BASE + bits) : " ";
      screen.set(r.x + col, r.y + row, ch, { fg: at(o.gradient, (fromBottom + 1) / r.h) });
    }
  }
}

// ── Sparkline (1 row, fits in a table cell) ──────────────────────────────────────────────

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function sparkline(
  data: readonly number[],
  width: number,
  max = Math.max(1e-9, ...data),
): string {
  return data
    .slice(-width)
    .map((v) => BARS[Math.min(7, Math.max(0, Math.round((v / max) * 7)))])
    .join("")
    .padStart(width, " ");
}

// ── Table ────────────────────────────────────────────────────────────────────────────────

export type Column = { title: string; width: Size; align?: "left" | "right" | "center" };
export type Cell = string | { text: string; style?: Style };

export type TableOptions = {
  selected?: number;
  /** First visible row. Use scrollTo() to keep the selection visible. */
  offset?: number;
  header?: Style;
  row?: Style;
  selectedBg?: RGB;
  gap?: number;
};

/** Header + rows, columns sized like layout tracks. Returns the body rect (for mouse hit-tests). */
export function table(
  screen: Screen,
  r: Rect,
  cols: Column[],
  data: Cell[][],
  o: TableOptions = {},
): Rect {
  const gap = o.gap ?? 1;
  const widths = resolveSizes(
    r.w,
    cols.map((c) => c.width),
    gap,
  );
  const drawRow = (y: number, cells: Cell[], base: Style | undefined): void => {
    let x = r.x;
    cols.forEach((c, i) => {
      const cell = cells[i] ?? "";
      const text = typeof cell === "string" ? cell : cell.text;
      const style = { ...base, ...(typeof cell === "string" ? {} : cell.style), bg: base?.bg };
      screen.text(x, y, pad(text, widths[i], c.align), style, widths[i]);
      x += widths[i] + gap;
    });
  };
  if (r.h < 1) return { ...r, h: 0 };
  drawRow(
    r.y,
    cols.map((c) => c.title),
    o.header ?? { bold: true },
  );
  const body = { x: r.x, y: r.y + 1, w: r.w, h: r.h - 1 };
  const offset = o.offset ?? 0;
  for (let i = 0; i < body.h; i++) {
    const idx = offset + i;
    const cells = data[idx];
    if (!cells) break;
    const selected = idx === o.selected;
    const base: Style = { ...o.row, ...(selected ? { bg: o.selectedBg, bold: true } : {}) };
    if (selected) screen.fill({ x: r.x, y: body.y + i, w: r.w, h: 1 }, " ", base);
    drawRow(body.y + i, cells, base);
  }
  return body;
}

/** New scroll offset so that `selected` stays within `visible` rows. */
export function scrollTo(selected: number, offset: number, visible: number): number {
  if (visible <= 0) return 0;
  if (selected < offset) return selected;
  if (selected >= offset + visible) return selected - visible + 1;
  return offset;
}

// ── Small pieces ─────────────────────────────────────────────────────────────────────────

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const spinner = (frame: number): string => SPINNER[frame % SPINNER.length];

/** A row of "label" tabs; the active one is highlighted. Returns columns used. */
export function tabs(
  screen: Screen,
  x: number,
  y: number,
  labels: string[],
  active: number,
  on: Style,
  off: Style,
): number {
  let col = 0;
  labels.forEach((l, i) => {
    col += screen.text(x + col, y, ` ${l} `, i === active ? on : off);
    col += 1;
  });
  return col;
}
