import { strWidth } from "./width";

/** What a click on a region does: press a key, or something a key cannot say (a tab, a log line). */
export type HitAction = "key" | "env" | "log";

export interface Hit {
  x: number;
  y: number;
  w: number;
  /** 0 is the screen, then one per open modal: only the topmost layer takes clicks. */
  layer: number;
  action: HitAction;
  /** The terminal input the key would send, for a "key" region. */
  input: string;
  /** An index for the other actions. */
  ref: number;
}

/**
 * The clickable regions of the last frame. They are rebuilt every frame by whatever draws a hint or a
 * button: the regions are reused from one frame to the next, so drawing allocates nothing new.
 */
export class HitMap {
  private readonly items: Hit[] = [];
  private size = 0;
  /** Layer of the regions added from now on. */
  layer = 0;

  get count(): number {
    return this.size;
  }

  clear(): void {
    this.size = 0;
    this.layer = 0;
  }

  add(x: number, y: number, w: number, action: HitAction, input = "", ref = -1): void {
    if (w <= 0) return;
    let hit = this.items[this.size];
    if (!hit) {
      hit = { x, y, w, layer: 0, action, input, ref };
      this.items.push(hit);
    }
    hit.x = x;
    hit.y = y;
    hit.w = w;
    hit.layer = this.layer;
    hit.action = action;
    hit.input = input;
    hit.ref = ref;
    this.size += 1;
  }

  /** The region of `layer` under a cell; the last one drawn wins. */
  at(x: number, y: number, layer: number): Hit | undefined {
    for (let i = this.size - 1; i >= 0; i--) {
      const hit = this.items[i] as Hit;
      if (hit.layer === layer && hit.y === y && x >= hit.x && x < hit.x + hit.w) return hit;
    }
    return undefined;
  }

  /** The regions that were drawn, in order. */
  toArray(): readonly Hit[] {
    return this.items.slice(0, this.size);
  }
}

/** What each word of a hint is on the keyboard: the input the terminal would send for it. */
const NAMED: Readonly<Record<string, string>> = {
  "↵": "\r",
  enter: "\r",
  esc: "\x1b",
  tab: "\t",
  PgUp: "\x1b[5~",
  PgDn: "\x1b[6~",
  Home: "\x1b[H",
  End: "\x1b[F",
  "ctrl+u": "\x15",
  "↑": "\x1b[A",
  "↓": "\x1b[B",
  "→": "\x1b[C",
  "←": "\x1b[D",
};
const ARROWS = /^[↑↓←→]+$/;
const SEPARATOR = " · ";

/** The input of a hint word that names a key, or undefined for a word that is not one. */
function keyInput(word: string): string | undefined {
  const named = NAMED[word];
  if (named) return named;
  return [...word].length === 1 && word >= "!" && word !== "\x7f" ? word : undefined;
}

/**
 * Registers the keys written in a hint like `p parameters`, or `↑↓ move · esc`, drawn at (x, y). Each
 * key is a region that sends that key. When a part of the hint holds a single key, its label is part
 * of the region: a click on `p parameters` is a `p`. `limit` is the column where the drawing was cut.
 */
export function registerHints(
  hits: HitMap,
  x: number,
  y: number,
  text: string,
  limit = Number.POSITIVE_INFINITY,
): void {
  let at = x;
  for (const part of text.split(SEPARATOR)) {
    const keys: { x: number; w: number; input: string }[] = [];
    let col = at;
    let isKeys = true;
    for (const word of part.split(" ")) {
      const width = strWidth(word);
      if (isKeys && word !== "") {
        const parts = ARROWS.test(word) ? [...word] : [word];
        const inputs = parts.map(keyInput);
        if (inputs.every((input) => input !== undefined)) {
          let from = col;
          for (const [i, input] of inputs.entries()) {
            const w = strWidth(parts[i] as string);
            keys.push({ x: from, w, input: input as string });
            from += w;
          }
        } else isKeys = false;
      }
      col += width + 1;
    }
    const end = Math.min(at + strWidth(part), limit);
    for (const key of keys) {
      if (key.x >= limit) continue;
      const alone = keys.length === 1;
      hits.add(key.x, y, alone ? end - key.x : Math.min(key.w, limit - key.x), "key", key.input);
    }
    at += strWidth(part) + strWidth(SEPARATOR);
  }
}
