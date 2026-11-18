import { ansi } from "./ansi";
import { type ColorMode, colorParams, type RGB } from "./color";
import type { Rect } from "./layout";
import { charWidth, graphemes } from "./width";

export type Style = {
  fg?: RGB;
  bg?: RGB;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};

const PLAIN = "\x1b[0m";
/** Marks "unknown" in the previous frame so the next flush repaints every cell. */
const INVALID = "\u0000";
/** Second half of a 2-column character. */
const CONT = "";

/** Full SGR sequence for a style. It always starts with reset (0), so each one stands alone. */
export function sgr(style: Style | undefined, mode: ColorMode): string {
  if (!style) return PLAIN;
  const p = ["0"];
  if (style.bold) p.push("1");
  if (style.dim) p.push("2");
  if (style.italic) p.push("3");
  if (style.underline) p.push("4");
  if (style.inverse) p.push("7");
  const fg = style.fg && colorParams(style.fg, mode, "fg");
  const bg = style.bg && colorParams(style.bg, mode, "bg");
  if (fg) p.push(fg);
  if (bg) p.push(bg);
  return `\x1b[${p.join(";")}m`;
}

/**
 * A grid of cells drawn in memory. Widgets write to the back frame; flush() compares it with
 * what the terminal already shows and returns only the escape codes needed to update the
 * cells that changed.
 */
export class Screen {
  width = 0;
  height = 0;
  readonly mode: ColorMode;
  private chars: string[] = [];
  private sgrs: string[] = [];
  private prevChars: string[] = [];
  private prevSgrs: string[] = [];

  constructor(width: number, height: number, mode: ColorMode) {
    this.mode = mode;
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    const n = this.width * this.height;
    this.chars = new Array(n).fill(" ");
    this.sgrs = new Array(n).fill(PLAIN);
    this.invalidate();
  }

  /** Forget what the terminal shows; the next flush repaints everything (after resize, resume...). */
  invalidate(): void {
    const n = this.width * this.height;
    this.prevChars = new Array(n).fill(INVALID);
    this.prevSgrs = new Array(n).fill("");
  }

  /** Blank the back frame. Call at the start of every frame. */
  clear(): void {
    this.chars.fill(" ");
    this.sgrs.fill(PLAIN);
  }

  /** Write ONE grapheme at (x, y). Returns the columns used (0 if clipped). */
  set(x: number, y: number, ch: string, style?: Style): number {
    return this.put(x, y, ch, sgr(style, this.mode));
  }

  /** Write a string clipped to `maxWidth` columns. Returns the columns used. */
  text(x: number, y: number, str: string, style?: Style, maxWidth = this.width - x): number {
    const s = sgr(style, this.mode);
    let col = 0;
    for (const g of graphemes(str)) {
      const w = charWidth(g);
      if (w === 0) continue;
      if (col + w > maxWidth) break;
      col += this.put(x + col, y, g, s) || w;
    }
    return col;
  }

  fill(r: Rect, ch = " ", style?: Style): void {
    const s = sgr(style, this.mode);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) this.put(x, y, ch, s);
  }

  private put(x: number, y: number, ch: string, s: string): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    let w = charWidth(ch);
    if (w === 0) return 0;
    if (w === 2 && x + 1 >= this.width) {
      ch = " "; // a wide char can't be cut in half: show a blank instead
      w = 1;
    }
    const i = y * this.width + x;
    this.breakWide(i);
    this.chars[i] = ch;
    this.sgrs[i] = s;
    if (w === 2) {
      this.breakWide(i + 1);
      this.chars[i + 1] = CONT;
      this.sgrs[i + 1] = s;
    }
    return w;
  }

  /** Overwriting half of a wide char: blank the other half so no stray glyph stays behind. */
  private breakWide(i: number): void {
    if (this.chars[i] === CONT && i % this.width !== 0) this.chars[i - 1] = " ";
    if (this.chars[i + 1] === CONT && (i + 1) % this.width !== 0) this.chars[i + 1] = " ";
  }

  /** Escape codes that bring the terminal from the previous frame to this one ("" if nothing changed). */
  flush(): string {
    let out = "";
    let lastSgr = "";
    let cursor = -1; // linear index where the terminal cursor is, -1 = unknown
    for (let i = 0; i < this.chars.length; i++) {
      const ch = this.chars[i];
      const s = this.sgrs[i];
      if (ch === this.prevChars[i] && s === this.prevSgrs[i]) continue;
      if (ch === CONT) continue; // drawn together with its first half
      if (cursor !== i) out += ansi.moveTo(Math.floor(i / this.width), i % this.width);
      if (s !== lastSgr) {
        out += s;
        lastSgr = s;
      }
      out += ch;
      cursor = i + (this.chars[i + 1] === CONT ? 2 : 1);
      if (cursor % this.width === 0) cursor = -1; // wrap is off: the cursor stays on the last column
    }
    this.prevChars = this.chars.slice();
    this.prevSgrs = this.sgrs.slice();
    return out ? out + ansi.reset : "";
  }

  /** The back frame as plain text (no colors), for snapshot tests. */
  toPlainText(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      lines.push(
        this.chars
          .slice(y * this.width, (y + 1) * this.width)
          .join("")
          .trimEnd(),
      );
    }
    return lines.join("\n");
  }
}
