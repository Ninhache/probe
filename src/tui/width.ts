/**
 * Terminal column width of text. JS `.length` counts UTF-16 units, NOT columns:
 * "é" may be 2 code points / 1 column, "日" is 1 code point / 2 columns, "👍🏽" is 4 units / 2 columns.
 * This is a dependency-free approximation; the `string-width` npm package is the exhaustive version.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (x) => x.segment);
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || // CJK, Kana, Yi...
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Columns taken by ONE grapheme: 0, 1 or 2. */
export function charWidth(g: string): 0 | 1 | 2 {
  const cp = g.codePointAt(0) ?? 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0; // control chars
  if (/^\p{Mark}/u.test(g)) return 0; // lone combining mark
  if (g.includes("️") && /\p{Extended_Pictographic}/u.test(g)) return 2; // emoji presentation
  return isWide(cp) ? 2 : 1;
}

export function strWidth(s: string): number {
  let w = 0;
  for (const g of graphemes(s)) w += charWidth(g);
  return w;
}

/** Cut to at most `max` columns, ending with `ellipsis` when something was cut. */
export function truncate(s: string, max: number, ellipsis = "…"): string {
  if (strWidth(s) <= max) return s;
  if (max <= 0) return "";
  let out = "";
  let w = 0;
  const limit = max - strWidth(ellipsis);
  for (const g of graphemes(s)) {
    const cw = charWidth(g);
    if (w + cw > limit) break;
    out += g;
    w += cw;
  }
  return out + ellipsis;
}

/** Pad (or truncate) to exactly `width` columns. */
export function pad(s: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const t = truncate(s, width);
  const gap = width - strWidth(t);
  if (align === "right") return " ".repeat(gap) + t;
  if (align === "center") return " ".repeat(gap >> 1) + t + " ".repeat(gap - (gap >> 1));
  return t + " ".repeat(gap);
}
