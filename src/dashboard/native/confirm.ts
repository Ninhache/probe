import type { InputEvent } from "../../tui/input";
import { defaultTheme as t } from "../../tui/theme";
import { strWidth } from "../../tui/width";
import type { Panel } from "./panels";

const WIDTH_MIN = 36;
const PADDING = 4;

/** A question answered with `y`; any other key keeps things as they are, `q` included. */
export function confirmModal(
  title: string,
  question: string,
  yes: () => void,
  footer = "y remove · n esc keep",
): Panel {
  return {
    title,
    bar: "confirm",
    footer,
    // No letter acts on the screen under a question: `q` answers no, it does not quit.
    typing: true,
    size: { w: Math.max(WIDTH_MIN, strWidth(question) + PADDING), h: 3 },
    draw(screen, inner) {
      screen.text(inner.x + 1, inner.y, question, { fg: t.fg }, inner.w - 1);
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key") return true;
      if (event.name === "y" && !event.ctrl && !event.alt) yes();
      return "close";
    },
  };
}
