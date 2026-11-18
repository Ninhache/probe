export type RGB = readonly [number, number, number];
export type ColorMode = "truecolor" | "256" | "none";

/**
 * Pick the color depth to emit.
 * NO_COLOR (https://no-color.org) wins, then FORCE_COLOR, then COLORTERM; non-TTY output gets no color.
 */
export function detectColorMode(
  env: Record<string, string | undefined> = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
): ColorMode {
  if (env.NO_COLOR) return "none";
  if (env.FORCE_COLOR === "0") return "none";
  if (!isTTY && env.FORCE_COLOR === undefined) return "none";
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit" || env.FORCE_COLOR === "3")
    return "truecolor";
  return "256";
}

/** Parse "#rrggbb" or "#rgb". Throws on anything else. */
export function hex(code: string): RGB {
  const h = code.replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) throw new Error(`Invalid hex color: ${code}`);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** xterm 6x6x6 cube levels; indexes 16-231 are the cube, 232-255 a 24-step gray ramp. */
const CUBE_STEP = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));

/** Nearest xterm-256 index, for terminals without truecolor (btop: truecolor_to_256). */
export function rgbTo256([r, g, b]: RGB): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  return 16 + 36 * CUBE_STEP(r) + 6 * CUBE_STEP(g) + CUBE_STEP(b);
}

/** SGR parameters for a color ("38;2;r;g;b", "48;5;n"...), or undefined when colors are off. */
export function colorParams(c: RGB, mode: ColorMode, layer: "fg" | "bg"): string | undefined {
  const base = layer === "fg" ? 38 : 48;
  if (mode === "none") return undefined;
  if (mode === "truecolor") return `${base};2;${c[0]};${c[1]};${c[2]}`;
  return `${base};5;${rgbTo256(c)}`;
}

/** Linear gradient through 2+ color stops, `steps` entries (btop uses 101: index = percent). */
export function gradient(stops: RGB[], steps = 101): RGB[] {
  if (stops.length < 2) throw new Error("gradient needs at least 2 stops");
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / (steps - 1)) * (stops.length - 1);
    const seg = Math.min(Math.floor(t), stops.length - 2);
    const f = t - seg;
    const a = stops[seg] ?? [0, 0, 0];
    const b = stops[seg + 1] ?? a;
    const mix = (k: 0 | 1 | 2) => Math.round(a[k] + (b[k] - a[k]) * f);
    return [mix(0), mix(1), mix(2)] as const;
  });
}

/** Pick the gradient color for a ratio in [0, 1]. */
export function at(g: RGB[], ratio: number): RGB {
  return g[Math.round(Math.min(1, Math.max(0, ratio)) * (g.length - 1))] ?? [0, 0, 0];
}
