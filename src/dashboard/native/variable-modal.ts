import { variableValueProblem } from "../../config/headers";
import { LOCAL_FILE, PROBE_DIR } from "../../constants";
import type { InputEvent } from "../../tui/input";
import { drawField, fieldKey, fieldValue, textField } from "../../tui/textfield";
import { defaultTheme as t } from "../../tui/theme";
import type { Panel } from "./panels";

const WIDTH = 64;
const BULLET = "•";
const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;

/** Asks the value of a variable of local.yml: what is typed is only ever drawn as bullets. */
export function variableModal(name: string, keep: (value: string) => void): Panel {
  let value = textField("", BULLET);
  let problem: string | undefined;
  return {
    title: name,
    bar: "input",
    typing: true,
    size: { w: WIDTH, h: 5 },
    draw(screen, inner) {
      const label = screen.text(inner.x + 1, inner.y, `Value of ${name}: `, { fg: t.fg });
      value = drawField(screen, inner.x + 1 + label, inner.y, inner.w - label - 2, value, {
        fg: t.fg,
      });
      const note = problem ?? `not shown, kept in ${LOCAL} on this machine only`;
      screen.text(inner.x + 1, inner.y + 2, note, { fg: problem ? t.warn : t.muted }, inner.w - 2);
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key") return true;
      if (event.name === "escape" && !event.ctrl && !event.alt) return false;
      if (event.name === "enter") {
        const wrong = variableValueProblem(fieldValue(value));
        if (wrong) {
          problem = `${name} expects ${wrong}`;
          return true;
        }
        keep(fieldValue(value));
        return "close";
      }
      const next = fieldKey(value, event);
      if (fieldValue(next) !== fieldValue(value)) problem = undefined;
      value = next;
      return true;
    },
  };
}
