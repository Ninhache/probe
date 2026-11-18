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

/** Draws `‹ value ›`; a chevron with nowhere to go is a space, so the text stays where it is. */
export function drawStepper(
  screen: Screen,
  x: number,
  y: number,
  value: string,
  reach: Reach,
  style: Style,
  selected: boolean,
  room: number,
): void {
  const chevron = { ...style, fg: selected ? t.accent : t.muted };
  screen.text(x, y, reach.previous ? PREVIOUS : " ", chevron, room);
  const used = screen.text(x + 2, y, value, style, room - 2);
  screen.text(x + 3 + used, y, reach.next ? NEXT : " ", chevron, room - 3 - used);
}
