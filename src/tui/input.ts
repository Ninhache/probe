import { graphemes } from "./width";

export type Key = {
  kind: "key";
  name: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  raw: string;
};
export type Mouse = {
  kind: "mouse";
  action: "press" | "release" | "drag" | "wheel-up" | "wheel-down";
  button: "left" | "middle" | "right" | "none";
  /** 0-based, same coordinates as Screen. */
  x: number;
  y: number;
  raw: string;
};
export type InputEvent = Key | Mouse;

const FINAL: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "tab",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
};
const TILDE: Record<string, string> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
  "15": "f5",
  "17": "f6",
  "18": "f7",
  "19": "f8",
  "20": "f9",
  "21": "f10",
  "23": "f11",
  "24": "f12",
};

const MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/; // SGR mouse: ESC [ < button ; x ; y M|m
const CSI_RE = /^\x1b\[([0-9;]*)([A-Za-z~])/; // ESC [ params final
const SS3_RE = /^\x1bO([A-Za-z])/; // ESC O final (some terminals' arrows / F1-F4)

const key = (name: string, raw: string, mods: Partial<Key> = {}): Key => ({
  kind: "key",
  name,
  raw,
  ctrl: false,
  alt: false,
  shift: false,
  ...mods,
});

function plain(g: string): Key {
  const c = g.charCodeAt(0);
  if (g === "\r" || g === "\n") return key("enter", g);
  if (g === "\t") return key("tab", g);
  if (g === "\x7f" || g === "\b") return key("backspace", g);
  if (g === " ") return key("space", g);
  if (c === 0) return key("space", g, { ctrl: true });
  if (c < 27) return key(String.fromCharCode(c + 96), g, { ctrl: true }); // \x01 = ctrl+a ... \x1a = ctrl+z
  return key(g.toLowerCase(), g, { shift: g !== g.toLowerCase() });
}

function csi(m: RegExpExecArray): Key {
  const params = m[1].split(";");
  const mod = Math.max(0, Number(params[1] ?? 1) - 1); // xterm: 1 + (shift 1 | alt 2 | ctrl 4)
  const name = m[2] === "~" ? TILDE[params[0]] : FINAL[m[2]];
  return key(name ?? "unknown", m[0], {
    shift: Boolean(mod & 1) || m[2] === "Z",
    alt: Boolean(mod & 2),
    ctrl: Boolean(mod & 4),
  });
}

function mouse(m: RegExpExecArray): Mouse {
  const b = Number(m[1]);
  const action: Mouse["action"] =
    b & 64
      ? b & 1
        ? "wheel-down"
        : "wheel-up"
      : b & 32
        ? "drag"
        : m[4] === "m"
          ? "release"
          : "press";
  const button = b & 64 ? "none" : (["left", "middle", "right", "none"] as const)[b & 3];
  return { kind: "mouse", action, button, x: Number(m[2]) - 1, y: Number(m[3]) - 1, raw: m[0] };
}

/**
 * Split one stdin chunk into events. A chunk can hold several keys (fast typing, paste) or a
 * whole escape sequence. A lone "\x1b" is the Escape key.
 */
export function parseInput(data: string): InputEvent[] {
  const events: InputEvent[] = [];
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    const m = MOUSE_RE.exec(rest) ?? CSI_RE.exec(rest);
    if (m) {
      events.push(m[0].startsWith("\x1b[<") ? mouse(m) : csi(m));
      i += m[0].length;
      continue;
    }
    const s = SS3_RE.exec(rest);
    if (s) {
      events.push(key(FINAL[s[1]] ?? "unknown", s[0]));
      i += s[0].length;
      continue;
    }
    if (rest[0] === "\x1b") {
      if (rest.length > 1 && rest[1] !== "\x1b") {
        const g = graphemes(rest.slice(1))[0];
        events.push({ ...plain(g), alt: true, raw: `\x1b${g}` });
        i += 1 + g.length;
      } else {
        events.push(key("escape", "\x1b"));
        i += 1;
      }
      continue;
    }
    const g = graphemes(rest)[0];
    events.push(plain(g));
    i += g.length;
  }
  return events;
}
