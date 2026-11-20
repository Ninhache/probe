import type { InputEvent } from "../../tui/input";
import { defaultTheme as t } from "../../tui/theme";
import type { VariableRow } from "../variables";
import { PAD, type Panel, row, variableText } from "./panels";
import type { ViewActions } from "./view";

const WIDTH = 72;
const MAX_ROWS = 14;

/**
 * Every variable the headers or env of the services of `env` send, and where each is set there.
 * Only the place is shown, never a value: enter and d go through the editor, which writes `env`'s own scope.
 */
export function variablesPanel(env: string, actions: ViewActions): Panel {
  const variables = actions.edit?.variables;
  let found: readonly VariableRow[] = [];
  let loaded = false;
  let at = 0;
  const load = () =>
    void variables?.all(env).then((rows) => {
      found = rows;
      loaded = true;
      at = Math.min(at, Math.max(0, rows.length - 1));
      actions.redraw?.();
    });
  load();
  return {
    title: `variables · ${env}`,
    bar: "variables",
    footer: "↑↓ variable · ↵ set · d remove · esc",
    get size() {
      return { w: WIDTH, h: Math.min(MAX_ROWS, Math.max(found.length, 1)) + 3 };
    },
    draw(screen, inner) {
      if (found.length === 0) {
        const text = loaded ? `No header or env of ${env} uses a variable` : "reading...";
        screen.text(inner.x + PAD, inner.y, text, { fg: t.muted }, inner.w - PAD);
        return;
      }
      const first = Math.max(0, Math.min(at - inner.h + 1, found.length - inner.h));
      found.slice(first, first + inner.h).forEach((variable, i) => {
        const on = first + i === at;
        row(screen, inner, i, variable.name, variableText(variable, on, true), on);
      });
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key" || event.ctrl || event.alt) return event.kind === "mouse";
      const moves: Record<string, number> = { up: -1, k: -1, down: 1, j: 1 };
      const picked = found[at];
      if (event.name in moves)
        at = Math.max(0, Math.min(found.length - 1, at + (moves[event.name] as number)));
      else if (event.name === "enter" && picked) variables?.set(picked, env, load);
      else if (event.name === "d" && picked) variables?.remove(picked, env, load);
      else if (event.name === "v") return "close";
      else return false;
      return true;
    },
  };
}
