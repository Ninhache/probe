import type { InputEvent } from "./input";
import { contains, type Rect } from "./layout";
import type { Screen, Style } from "./screen";
import { scrollTo } from "./widgets";
import { pad } from "./width";

/** Pure state of a scrolling list: the selected row and the first visible one. */
export type ListState = { selected: number; offset: number };

/** What the list needs to know each time: how many rows there are and where the rows are drawn. */
export type ListGeometry = { count: number; body: Rect };

export const listState = (selected = 0): ListState => ({ selected, offset: 0 });

const WHEEL_STEP = 3;

function moveTo(s: ListState, target: number, { count, body }: ListGeometry): ListState {
  if (count === 0) return { selected: 0, offset: 0 };
  const selected = Math.max(0, Math.min(count - 1, target));
  return { selected, offset: scrollTo(selected, s.offset, body.h) };
}

/** Selection and scroll after a key. Unknown keys return the same object. */
export function listKey(s: ListState, event: InputEvent, g: ListGeometry): ListState {
  if (event.kind !== "key" || event.ctrl || event.alt) return s;
  const page = Math.max(1, g.body.h - 1);
  switch (event.name) {
    case "up":
    case "k":
      return moveTo(s, s.selected - 1, g);
    case "down":
    case "j":
      return moveTo(s, s.selected + 1, g);
    case "pageup":
      return moveTo(s, s.selected - page, g);
    case "pagedown":
      return moveTo(s, s.selected + page, g);
    case "home":
      return moveTo(s, 0, g);
    case "end":
      return moveTo(s, g.count - 1, g);
    default:
      return s;
  }
}

/** The wheel scrolls the view and drags the selection along; a left click selects the row under it. */
export function listMouse(s: ListState, event: InputEvent, g: ListGeometry): ListState {
  if (event.kind !== "mouse") return s;
  if (event.action === "wheel-up" || event.action === "wheel-down") {
    const direction = event.action === "wheel-up" ? -1 : 1;
    return moveTo(s, s.selected + direction * WHEEL_STEP, g);
  }
  if (event.action === "press" && event.button === "left" && contains(g.body, event.x, event.y)) {
    const row = s.offset + event.y - g.body.y;
    return row < g.count ? moveTo(s, row, g) : s;
  }
  return s;
}

/** Re-clamp after the content or the area changed (a filter, a resize). */
export const clampList = (s: ListState, g: ListGeometry): ListState => moveTo(s, s.selected, g);

export type ListStyles = { row?: Style; selected?: Style };

/** Draw the visible rows; the selected one gets a full-width highlight. */
export function renderList(
  screen: Screen,
  body: Rect,
  items: readonly string[],
  s: ListState,
  styles: ListStyles = {},
): void {
  for (let i = 0; i < body.h; i++) {
    const item = items[s.offset + i];
    if (item === undefined) break;
    const style = s.offset + i === s.selected ? { ...styles.row, ...styles.selected } : styles.row;
    if (style?.bg) screen.fill({ x: body.x, y: body.y + i, w: body.w, h: 1 }, " ", style);
    screen.text(body.x, body.y + i, pad(item, body.w), style, body.w);
  }
}
