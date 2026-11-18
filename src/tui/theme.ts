import { gradient, hex, type RGB } from "./color";

/** Colors by role, not by hue: widgets ask for "border" or "err", never "red". */
export type Theme = {
  fg: RGB;
  muted: RGB;
  border: RGB;
  borderFocus: RGB;
  title: RGB;
  accent: RGB;
  ok: RGB;
  warn: RGB;
  err: RGB;
  selectedBg: RGB;
  meterBg: RGB;
  /** 101-step gradients, index = percent. */
  latency: RGB[];
  health: RGB[];
};

export function makeTheme(
  c: Record<
    | "fg"
    | "muted"
    | "border"
    | "borderFocus"
    | "title"
    | "accent"
    | "ok"
    | "warn"
    | "err"
    | "selectedBg"
    | "meterBg",
    string
  >,
): Theme {
  const t = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, hex(v)])) as Record<
    keyof typeof c,
    RGB
  >;
  return {
    ...t,
    latency: gradient([t.ok, t.warn, t.err]), // low = good
    health: gradient([t.err, t.warn, t.ok]), // high = good
  };
}

export const defaultTheme: Theme = makeTheme({
  fg: "#d4d4d8",
  muted: "#71717a",
  border: "#3f3f46",
  borderFocus: "#60a5fa",
  title: "#e4e4e7",
  accent: "#f0abfc",
  ok: "#4ade80",
  warn: "#facc15",
  err: "#f87171",
  selectedBg: "#27272a",
  meterBg: "#27272a",
});
