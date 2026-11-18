import type { InputEvent } from "../../tui/input";
import { drawField, fieldKey, fieldValue, textField } from "../../tui/textfield";
import { defaultTheme as t } from "../../tui/theme";
import { pad } from "../../tui/width";
import { type Command, paletteEntries } from "../keymap";
import type { Panel } from "./panels";

const WIDTH = 46;
const KEYS_WIDTH = 8;
const PROMPT = ": ";

/** Every command of the keymap, narrowed by what is typed: enter runs the one under the cursor. */
export function paletteModal(choose: (command: Command) => void): Panel {
  let query = textField();
  let at = 0;
  const entries = () => paletteEntries(true, fieldValue(query), true);
  const total = paletteEntries(true, "", true).length;
  return {
    title: "commands",
    bar: "palette",
    typing: true,
    size: { w: WIDTH, h: total + 3 },
    draw(screen, inner) {
      const prompt = screen.text(inner.x + 1, inner.y, PROMPT, { fg: t.accent, bold: true });
      query = drawField(screen, inner.x + 1 + prompt, inner.y, inner.w - prompt - 2, query, {
        fg: t.fg,
      });
      const found = entries();
      const room = Math.max(1, inner.h - 1);
      // On a short terminal the list scrolls, the selected command always in sight.
      const first = Math.max(0, Math.min(at - room + 1, found.length - room));
      found.slice(first, first + room).forEach((entry, row) => {
        const on = first + row === at;
        const style = on ? { fg: t.title, bg: t.selectedBg, bold: true } : { fg: t.fg };
        const y = inner.y + 1 + row;
        screen.fill({ x: inner.x, y, w: inner.w, h: 1 }, " ", style);
        screen.text(inner.x + 1, y, pad(entry.label, inner.w - KEYS_WIDTH - 2), style, inner.w - 2);
        screen.text(
          inner.x + inner.w - KEYS_WIDTH,
          y,
          pad(entry.keys, KEYS_WIDTH - 1, "right"),
          { ...style, fg: on ? t.title : t.accent },
          KEYS_WIDTH,
        );
      });
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key") return true;
      const found = entries();
      if (event.name === "escape" && !event.ctrl && !event.alt) return false;
      if (event.name === "up") at = Math.max(0, at - 1);
      else if (event.name === "down") at = Math.max(0, Math.min(found.length - 1, at + 1));
      else if (event.name === "enter") {
        const entry = found[at];
        if (!entry) return true;
        choose(entry.command);
        return "close";
      } else {
        const next = fieldKey(query, event);
        if (fieldValue(next) !== fieldValue(query)) at = 0;
        query = next;
      }
      return true;
    },
  };
}
