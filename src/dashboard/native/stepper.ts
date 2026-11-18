import type { Screen, Style } from "../../tui/screen";
import { defaultTheme as t } from "../../tui/theme";

const PREVIOUS = "‹";
const NEXT = "›";

/** Which way a value can still move. */
export interface Reach {
  previous: boolean;
  next: boolean;
}

/** The place in a list of values: no value is before the first one, none after the last. */
export const reachAt = (index: number, count: number): Reach => ({
  previous: index > 0,
  next: index >= 0 && index < count - 1,
});

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";

/** The keys that bring the cursor `rows` lines down (up when negative), then step: what a click on a chevron sends. */
const stepKeys = (rows: number, arrow: string): string =>
  (rows < 0 ? UP : DOWN).repeat(Math.abs(rows)) + arrow;

/**
 * Draws `‹ value ›`; a chevron with nowhere to go is a space, so the text stays where it is. A chevron
 * is a button: a click moves the cursor to this line, `rows` away from where it is, and steps like ← or →.
 */
export function drawStepper(
  screen: Screen,
  x: number,
  y: number,
  value: string,
  reach: Reach,
  style: Style,
  selected: boolean,
  room: number,
  rows = 0,
): void {
  const chevron = { ...style, fg: selected ? t.accent : t.muted };
  const before = screen.text(x, y, reach.previous ? PREVIOUS : " ", chevron, room);
  if (reach.previous && before > 0) screen.hits.add(x, y, 1, "key", stepKeys(rows, LEFT));
  const used = screen.text(x + 2, y, value, style, room - 2);
  const after = screen.text(x + 3 + used, y, reach.next ? NEXT : " ", chevron, room - 3 - used);
  if (reach.next && after > 0) screen.hits.add(x + 3 + used, y, 1, "key", stepKeys(rows, RIGHT));
}
