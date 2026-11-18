import { effectiveSelection, type ParameterChoices } from "../../config/parameters";
import { LOCAL_FILE } from "../../constants";
import type { InputEvent } from "../../tui/input";
import type { Rect } from "../../tui/layout";
import type { Modal } from "../../tui/modal";
import type { Screen } from "../../tui/screen";
import { defaultTheme as t } from "../../tui/theme";
import { pad } from "../../tui/width";
import { detailLines } from "../detail";
import type { Screen as KeymapScreen } from "../keymap";
import { SETTING_ROWS, stepChoice, stepServiceTimeout } from "../settings";
import type { VariableRow } from "../variables";
import { LOCAL_ENVIRONMENT, type Tracker } from "./history";
import type { ViewActions, ViewState } from "./view";

const PANEL_WIDTH = 72;
const MARGIN = 2;
const OPTIONS_WIDTH = 40;
const PAD = 1;
const SOURCES = { environment: "set in the environment", local: `set in ${LOCAL_FILE}` };

/** A modal and the keymap screen whose bindings the help bar shows while it is open. */
export type Panel = Modal & { bar: KeymapScreen };

const tones = { good: t.ok, bad: t.err, dim: t.muted } as const;
const seconds = (ms: number) => `${ms / 1000}s`;
const row = (screen: Screen, inner: Rect, i: number, label: string, value: string, on: boolean) => {
  const style = on ? { fg: t.title, bg: t.selectedBg, bold: true } : { fg: t.fg };
  screen.fill({ x: inner.x, y: inner.y + i, w: inner.w, h: 1 }, " ", style);
  screen.text(inner.x + PAD, inner.y + i, pad(label, 14), style, inner.w - PAD);
  screen.text(inner.x + PAD + 14, inner.y + i, value, { ...style, fg: t.accent }, inner.w);
};

/** What `detailLines` says about a service, for every service type, plus its timeout and skip. */
export function detailPanel(
  area: Rect,
  tracker: Tracker,
  view: ViewState,
  service: string,
  env: string,
  actions: ViewActions,
): Panel {
  const writable = env === LOCAL_ENVIRONMENT;
  const width = Math.min(PANEL_WIDTH, area.w - MARGIN * 2);
  const variables = writable ? actions.edit?.variables : undefined;
  let found: readonly VariableRow[] = [];
  // -1 is no variable: enter then closes the panel, as on the ink screen.
  let at = -1;
  const load = () =>
    void variables?.load(service).then((rows) => {
      found = rows;
      actions.redraw?.();
    });
  load();
  const extra = () => (writable ? 2 + found.length : 0);
  const lines = () => {
    const result = tracker.result(service, env);
    const history = (tracker.history(service, env)?.toArray() ?? []).map((s) => s.latencyMs);
    const room = Math.max(4, area.h - 2 - MARGIN * 2 - extra());
    return result
      ? detailLines(result, history, { unicode: true, width: width - 2 - PAD * 2, room })
      : [{ id: "wait", text: "no result yet", tone: "dim" as const }];
  };
  return {
    title: `${service}@${env}`,
    bar: writable ? "detail" : "readonly",
    footer: writable ? "←→ timeout · s skip · u open · c copy · esc" : "u open · c copy · esc",
    get size() {
      return { w: width, h: Math.min(area.h - 2, lines().length + extra() + 3) };
    },
    draw(screen, inner) {
      const shown = lines();
      shown.forEach((line, i) => {
        if (i >= inner.h - extra()) return;
        const fg = line.tone ? tones[line.tone] : t.fg;
        screen.text(inner.x + PAD, inner.y + i, line.text, { fg }, inner.w - PAD);
      });
      if (!writable) return;
      const timeout = view.timeouts[service];
      const first = inner.h - extra();
      row(
        screen,
        inner,
        first,
        "timeout",
        timeout === undefined ? "default" : `${timeout}s`,
        false,
      );
      row(screen, inner, first + 1, "skip", view.skipped.has(service) ? "yes" : "no", false);
      found.forEach(({ name, source }, i) => {
        const offer =
          at === i && source !== "environment" ? ` · ↵ ${source ? "changes" : "sets"} it` : "";
        row(
          screen,
          inner,
          first + 2 + i,
          name,
          `${source ? SOURCES[source] : "not set"}${offer}`,
          at === i,
        );
      });
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key" || event.ctrl || event.alt) return event.kind === "mouse";
      if (event.name === "enter") {
        const variable = found[at];
        if (!variable) return "close";
        variables?.set(variable, load);
        return true;
      }
      if (writable && found.length > 0 && (event.name === "up" || event.name === "down")) {
        at = Math.max(-1, Math.min(found.length - 1, at + (event.name === "down" ? 1 : -1)));
        return true;
      }
      if (event.name === "u") actions.open?.(service, env);
      else if (event.name === "c") actions.copy?.(service, env);
      else if (!writable) return false;
      else if (at >= 0 && (event.name === "left" || event.name === "right")) return true;
      else if (event.name === "left" || event.name === "right") {
        const next = stepServiceTimeout(view.timeouts[service], event.name === "right" ? 1 : -1);
        if (next === view.timeouts[service]) return true;
        view.timeouts = { ...view.timeouts, [service]: next };
        actions.timeout?.(service, next);
      } else if (event.name === "s") {
        const skip = !view.skipped.has(service);
        const next = new Set(view.skipped);
        if (skip) next.add(service);
        else next.delete(service);
        view.skipped = next;
        actions.skip?.(service, skip);
      } else return false;
      return true;
    },
  };
}

/** Interval, timeout and notifications, stepped with the arrows and saved at once. */
export function optionsPanel(view: ViewState, actions: ViewActions): Panel {
  const rows = SETTING_ROWS.length + 1;
  let at = 0;
  return {
    title: "options",
    bar: "panel",
    footer: "↑↓ move · ←→ change · esc",
    size: { w: OPTIONS_WIDTH, h: rows + 2 },
    draw(screen, inner) {
      for (const [i, each] of SETTING_ROWS.entries())
        row(screen, inner, i, each.label, seconds(view.settings[each.key]), i === at);
      row(screen, inner, rows - 1, "Notify", view.settings.notify ? "on" : "off", at === rows - 1);
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key" || event.ctrl || event.alt) return event.kind === "mouse";
      if (event.name === "up" || event.name === "k") at = Math.max(0, at - 1);
      else if (event.name === "down" || event.name === "j") at = Math.min(rows - 1, at + 1);
      else if (["left", "right", "h", "l"].includes(event.name)) {
        const direction = event.name === "right" || event.name === "l" ? 1 : -1;
        const each = SETTING_ROWS[at];
        const next = each
          ? {
              ...view.settings,
              [each.key]: stepChoice(each.choicesMs, view.settings[each.key], direction),
            }
          : { ...view.settings, notify: !view.settings.notify };
        if (each && next[each.key] === view.settings[each.key]) return true;
        view.settings = next;
        actions.settings?.(next);
      } else if (event.name === "o") return "close";
      else return false;
      return true;
    },
  };
}

/** What each parameter is set to. */
export function selected(view: ViewState): Readonly<Record<string, string>> {
  return effectiveSelection(view.choices, view.selection);
}

/** One row per parameter: ←→ pick the parameter, ↑↓ change its value, as on the ink screen. */
export function parametersPanel(view: ViewState, actions: ViewActions): Panel {
  const names = (choices: ParameterChoices) => Object.keys(choices);
  let at = 0;
  return {
    title: "parameters",
    bar: "choose",
    footer: "←→ parameter · ↑↓ value · esc",
    get size() {
      return { w: OPTIONS_WIDTH + 8, h: Math.max(1, names(view.choices).length) + 2 };
    },
    draw(screen, inner) {
      const all = names(view.choices);
      if (view.parameterAt !== undefined) {
        at = Math.max(0, all.indexOf(view.parameterAt));
        view.parameterAt = undefined;
      }
      at = Math.max(0, Math.min(at, all.length - 1));
      if (all.length === 0)
        screen.text(inner.x + 1, inner.y, "None yet: a adds one", { fg: t.muted });
      const now = selected(view);
      for (const [i, name] of names(view.choices).entries())
        row(screen, inner, i, name, now[name] ?? "", i === at);
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key" || event.ctrl || event.alt) return event.kind === "mouse";
      const all = names(view.choices);
      const parameters = actions.edit?.parameters;
      const here = all[at];
      if (parameters && event.name === "a") parameters.add();
      else if (parameters && here !== undefined && event.name === "e") parameters.edit(here);
      else if (parameters && here !== undefined && event.name === "d") parameters.remove(here);
      else if (event.name === "left" || event.name === "h") at = Math.max(0, at - 1);
      else if (event.name === "right" || event.name === "l") at = Math.min(all.length - 1, at + 1);
      else if (["up", "down", "k", "j"].includes(event.name)) {
        const name = all[at];
        const values = name === undefined ? undefined : view.choices[name];
        if (name === undefined || !values) return true;
        const current = selected(view)[name] as string;
        const step = event.name === "down" || event.name === "j" ? 1 : -1;
        const value =
          values[Math.max(0, Math.min(values.length - 1, values.indexOf(current) + step))];
        if (value === undefined || value === current) return true;
        view.selection = { ...view.selection, [name]: value };
        actions.parameter?.(name, value);
      } else if (event.name === "p") return "close";
      else return false;
      return true;
    },
  };
}
