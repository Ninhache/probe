export type Rect = { x: number; y: number; w: number; h: number };

/** A track size: fixed columns/rows, a percentage of the space, or a share of what's left. */
export type Size = number | `${number}%` | { fill: number };
export const fill = (weight = 1): Size => ({ fill: weight });

/** Turn sizes into concrete lengths that sum to at most `total`. Fixed and % first, fills share the rest. */
export function resolveSizes(total: number, sizes: Size[], gap = 0): number[] {
  const avail = Math.max(0, total - gap * Math.max(0, sizes.length - 1));
  const out = sizes.map(() => 0);
  let used = 0;
  let weights = 0;
  sizes.forEach((s, i) => {
    if (typeof s === "number") out[i] = s;
    else if (typeof s === "string") out[i] = Math.floor((avail * Number.parseFloat(s)) / 100);
    else {
      weights += s.fill;
      return;
    }
    used += out[i];
  });
  if (weights > 0) {
    const remaining = Math.max(0, avail - used);
    let left = remaining;
    let lastFill = -1;
    sizes.forEach((s, i) => {
      if (typeof s !== "object") return;
      out[i] = Math.floor((remaining * s.fill) / weights);
      left -= out[i];
      lastFill = i;
    });
    out[lastFill] += left; // rounding leftovers go to the last fill
  }
  // Too small? Take the overflow back from the end so nothing draws outside the parent.
  let over = out.reduce((a, b) => a + b, 0) - avail;
  for (let i = out.length - 1; over > 0 && i >= 0; i--) {
    const cut = Math.min(out[i], over);
    out[i] -= cut;
    over -= cut;
  }
  return out;
}

/** Split side by side (left to right). */
export function columns(r: Rect, sizes: Size[], gap = 0): Rect[] {
  let x = r.x;
  return resolveSizes(r.w, sizes, gap).map((w) => {
    const c = { x, y: r.y, w, h: r.h };
    x += w + gap;
    return c;
  });
}

/** Split stacked (top to bottom). */
export function rows(r: Rect, sizes: Size[], gap = 0): Rect[] {
  let y = r.y;
  return resolveSizes(r.h, sizes, gap).map((h) => {
    const c = { x: r.x, y, w: r.w, h };
    y += h + gap;
    return c;
  });
}

export function inset(r: Rect, n = 1): Rect {
  return { x: r.x + n, y: r.y + n, w: Math.max(0, r.w - 2 * n), h: Math.max(0, r.h - 2 * n) };
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
