import type { CheckResult } from "../../checkers/types";
import { effectiveSelection, type ParameterChoices } from "../../config/parameters";
import { JSON_FORMAT_MAX_BYTES, LOCAL_FILE } from "../../constants";
import type { RGB } from "../../tui/color";
import type { InputEvent } from "../../tui/input";
import type { Rect } from "../../tui/layout";
import type { Modal } from "../../tui/modal";
import type { Screen } from "../../tui/screen";
import { defaultTheme as t } from "../../tui/theme";
import { pad } from "../../tui/width";
import { detailLines } from "../detail";
import {
  foldSpans,
  formattedBody,
  type JsonKind,
  type JsonSpan,
  jsonLines,
  jsonTooBig,
} from "../json-body";
import type { Screen as KeymapScreen } from "../keymap";
import { NO_RESPONSE, responseLines, responseProblem, responseText } from "../response";
import { SETTING_ROWS, stepChoice, stepServiceTimeout } from "../settings";
import type { VariableRow } from "../variables";
import { LOCAL_ENVIRONMENT, type Tracker } from "./history";
import { drawStepper, type Reach, reachAt } from "./stepper";
import { say, type ViewActions, type ViewState } from "./view";

const PANEL_WIDTH = 72;
const RESPONSE_WIDTH = 120;
const MARGIN = 2;
const OPTIONS_WIDTH = 40;
export const PAD = 1;
const SOURCES = { environment: "set in the environment", local: `set in ${LOCAL_FILE}` };

/** A modal and the keymap screen whose bindings the help bar shows while it is open. */
export type Panel = Modal & { bar: KeymapScreen };

export const tones = { good: t.ok, bad: t.err, dim: t.muted } as const;
const seconds = (ms: number) => `${ms / 1000}s`;
export const row = (
  screen: Screen,
  inner: Rect,
  i: number,
  label: string,
  value: string,
  on: boolean,
) => {
  const style = on ? { fg: t.title, bg: t.selectedBg, bold: true } : { fg: t.fg };
  screen.fill({ x: inner.x, y: inner.y + i, w: inner.w, h: 1 }, " ", style);
  screen.text(inner.x + PAD, inner.y + i, pad(label, 14), style, inner.w - PAD);
  screen.text(inner.x + PAD + 14, inner.y + i, value, { ...style, fg: t.accent }, inner.w);
};

/** Where a variable is set, and what enter does to it on the selected row: its value is never shown. */
export const variableText = ({ source }: VariableRow, on: boolean, removable = false) => {
  const offer = on && source !== "environment" ? ` · ↵ ${source ? "changes" : "sets"} it` : "";
  const drop = on && removable && source === "local" ? " · d removes it" : "";
  return `${source ? SOURCES[source] : "not set"}${offer}${drop}`;
};

/** A line cut in pieces of the width of the view: nothing of a long line is lost. */
function folds(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const letters = Array.from(text);
  if (letters.length <= width) return [text];
  return Array.from({ length: Math.ceil(letters.length / width) }, (_, i) =>
    letters.slice(i * width, (i + 1) * width).join(""),
  );
}

export interface ResponseRow {
  text: string;
  tone?: keyof typeof tones;
  /** A line of highlighted JSON: drawn piece by piece instead of as `text`. */
  spans?: JsonSpan[];
}

const jsonColors: Record<JsonKind, RGB> = {
  key: t.accent,
  string: t.ok,
  number: t.warn,
  boolean: t.borderFocus,
  null: t.err,
  punct: t.muted,
};

/** Draws a row of a response, the JSON ones in colour. */
export function drawRow(screen: Screen, x: number, y: number, row: ResponseRow, width: number) {
  if (!row.spans)
    return screen.text(x, y, row.text, { fg: row.tone ? tones[row.tone] : t.fg }, width);
  let used = 0;
  for (const span of row.spans)
    used += screen.text(x + used, y, span.text, { fg: jsonColors[span.kind] }, width - used);
  return used;
}

const rowCache = new WeakMap<CheckResult, Map<number, ResponseRow[]>>();

/**
 * The lines of a response: its status, its headers, a blank, the body, whole, folded to `fit`.
 * Worked out once per result and width: a draw only slices what is in view, so the cost of a
 * frame does not grow with the body. The rows must not be changed.
 */
export function responseRows(result: CheckResult, fit: number): ResponseRow[] {
  const byWidth = rowCache.get(result) ?? new Map<number, ResponseRow[]>();
  rowCache.set(result, byWidth);
  const hit = byWidth.get(fit);
  if (hit) return hit;
  const rows = buildRows(result, fit);
  byWidth.set(fit, rows);
  return rows;
}

function buildRows(result: CheckResult, fit: number): ResponseRow[] {
  const { head, body, note } = responseLines(result);
  const json = jsonLines(result.response);
  const folded = (text: string, tone?: ResponseRow["tone"]) =>
    folds(text, fit).map((piece) => ({ text: piece, tone }));
  const big = jsonTooBig(result.response);
  return [
    ...head.flatMap((text, i) => folded(text, i === 0 ? (result.ok ? "good" : "bad") : "dim")),
    { text: "" },
    ...(big
      ? [
          {
            text: `JSON not formatted: body over ${JSON_FORMAT_MAX_BYTES / 1024} KiB`,
            tone: "dim" as const,
          },
        ]
      : []),
    ...(json
      ? json.flatMap((line) =>
          foldSpans(line, fit).map((spans) => ({ text: spans.map((s) => s.text).join(""), spans })),
        )
      : body.flatMap((text) => folded(text))),
    ...(note ? [{ text: note, tone: "dim" as const }] : []),
  ];
}

/** Copies only the body of a response, as it is on screen: the status line says how it went. */
export function copyBody(view: ViewState, actions: ViewActions, result: CheckResult | undefined) {
  const problem = responseProblem(result);
  if (problem || !result) return say(view, problem ?? NO_RESPONSE);
  const body = result.response?.body;
  if (!body) return say(view, "The response has no body to copy");
  const formatted = formattedBody(result.response);
  actions.copyResponse?.(
    formatted ?? body,
    result.response?.bodyCut === true,
    "body",
    formatted !== undefined,
  );
}

/** A row whose value moves with ←→: drawn `‹ value ›`. */
const stepRow = (
  screen: Screen,
  inner: Rect,
  i: number,
  label: string,
  value: string,
  reach: Reach,
  on: boolean,
  rows = 0,
) => {
  row(screen, inner, i, label, "", on);
  const style = { fg: t.accent, ...(on ? { bg: t.selectedBg, bold: true } : {}) };
  drawStepper(
    screen,
    inner.x + PAD + 14,
    inner.y + i,
    value,
    reach,
    style,
    on,
    inner.w - PAD - 14,
    rows,
  );
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
  const variables = actions.edit?.variables;
  let found: readonly VariableRow[] = [];
  // -1 is no variable: enter then closes the panel.
  let at = -1;
  const load = () =>
    void variables?.load(service, env).then((rows) => {
      found = rows;
      actions.redraw?.();
    });
  load();
  // The timeout and skip rows are the local config's: an environment's panel has the variables alone.
  const extra = () => (writable ? 2 : 0) + found.length;
  const lines = () => {
    const result = tracker.result(service, env);
    const history = (tracker.history(service, env)?.toArray() ?? []).map((s) => s.latencyMs);
    const room = Math.max(4, area.h - 2 - MARGIN * 2 - extra());
    return result
      ? detailLines(result, history, { unicode: true, width: width - 2 - PAD * 2, room })
      : [{ id: "wait", text: "no result yet", tone: "dim" as const }];
  };
  // The response view: the whole of the last answer, scrolled instead of cut.
  let responding = false;
  let top = 0;
  // The frame and its border take two rows each way.
  const room = Math.max(1, area.h - 4);
  const responseWidth = Math.min(RESPONSE_WIDTH, area.w - MARGIN * 2);
  const rows = (): ResponseRow[] => {
    const result = tracker.result(service, env);
    return result ? responseRows(result, responseWidth - 2 - PAD * 2) : [];
  };
  const respond = () => {
    const problem = responseProblem(tracker.result(service, env));
    if (problem) say(view, problem);
    else {
      responding = true;
      top = 0;
    }
  };
  const scroll = (to: number) => {
    top = Math.max(0, Math.min(to, rows().length - room));
  };
  return {
    get title() {
      if (!responding) return `${service}@${env}`;
      const total = rows().length;
      return `${service}@${env} · response ${Math.min(top + 1, total)}-${Math.min(top + room, total)}/${total}`;
    },
    get bar() {
      if (responding) return "response";
      return writable ? "detail" : "readonly";
    },
    get footer() {
      if (responding) return "↑↓ PgUp PgDn scroll · c copy · b body · r back · esc";
      return writable
        ? "←→ timeout · s skip · u open · c copy · r response · esc"
        : `${found.length > 0 ? "↑↓ variable · " : ""}u open · c copy · r response · esc`;
    },
    get size() {
      if (responding) return { w: responseWidth, h: area.h - 2 };
      return { w: width, h: Math.min(area.h - 2, lines().length + extra() + 3) };
    },
    draw(screen, inner) {
      if (responding) {
        const all = rows();
        top = Math.max(0, Math.min(top, all.length - room));
        all.slice(top, top + room).forEach((line, i) => {
          drawRow(screen, inner.x + PAD, inner.y + i, line, inner.w - PAD);
        });
        return;
      }
      const shown = lines();
      shown.forEach((line, i) => {
        if (i >= inner.h - extra()) return;
        const fg = line.tone ? tones[line.tone] : t.fg;
        screen.text(inner.x + PAD, inner.y + i, line.text, { fg }, inner.w - PAD);
        if (line.id.startsWith("request "))
          screen.hits.add(inner.x + PAD, inner.y + i, inner.w - PAD, "key", "u");
      });
      const first = inner.h - extra();
      const variablesAt = first + (writable ? 2 : 0);
      if (writable) {
        const timeout = view.timeouts[service];
        stepRow(
          screen,
          inner,
          first,
          "timeout",
          timeout === undefined ? "default" : `${timeout}s`,
          {
            previous: timeout !== undefined,
            next: stepServiceTimeout(timeout, 1) !== timeout,
          },
          at < 0,
          -(at + 1),
        );
        row(screen, inner, first + 1, "skip", view.skipped.has(service) ? "yes" : "no", false);
      }
      found.forEach((variable, i) => {
        row(
          screen,
          inner,
          variablesAt + i,
          variable.name,
          variableText(variable, at === i),
          at === i,
        );
      });
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key" || event.ctrl || event.alt) return event.kind === "mouse";
      if (responding) {
        const keys: Record<string, number> = {
          up: top - 1,
          down: top + 1,
          pageup: top - room,
          pagedown: top + room,
          home: 0,
          end: Number.MAX_SAFE_INTEGER,
        };
        if (event.name in keys) scroll(keys[event.name] as number);
        else if (event.name === "r") responding = false;
        else if (event.name === "b") copyBody(view, actions, tracker.result(service, env));
        else if (event.name === "c") {
          const result = tracker.result(service, env);
          const text = result && responseText(result);
          if (text !== undefined) actions.copyResponse?.(text, result?.response?.bodyCut === true);
        } else return false;
        return true;
      }
      if (event.name === "r") {
        respond();
        return true;
      }
      if (event.name === "enter") {
        const variable = found[at];
        if (!variable) return "close";
        variables?.set(variable, env, load);
        return true;
      }
      if (found.length > 0 && (event.name === "up" || event.name === "down")) {
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
      for (const [i, each] of SETTING_ROWS.entries()) {
        const now = view.settings[each.key];
        const reach = reachAt(each.choicesMs.indexOf(now), each.choicesMs.length);
        stepRow(screen, inner, i, each.label, seconds(now), reach, i === at, i - at);
      }
      const on = view.settings.notify === true;
      stepRow(
        screen,
        inner,
        rows - 1,
        "Notify",
        on ? "on" : "off",
        { previous: on, next: !on },
        at === rows - 1,
        rows - 1 - at,
      );
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

/** One row per parameter: ←→ pick the parameter, ↑↓ change its value. */
export function parametersPanel(view: ViewState, actions: ViewActions): Panel {
  const names = (choices: ParameterChoices) => Object.keys(choices);
  let at = 0;
  return {
    title: "parameters",
    bar: "choose",
    footer: "↑↓ parameter · ←→ value · esc",
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
      for (const [i, name] of names(view.choices).entries()) {
        const values = view.choices[name] ?? [];
        const reach = reachAt(values.indexOf(now[name] as string), values.length);
        stepRow(screen, inner, i, name, now[name] ?? "", reach, i === at, i - at);
      }
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key" || event.ctrl || event.alt) return event.kind === "mouse";
      const all = names(view.choices);
      const parameters = actions.edit?.parameters;
      const here = all[at];
      if (parameters && event.name === "a") parameters.add();
      else if (parameters && here !== undefined && event.name === "e") parameters.edit(here);
      else if (parameters && here !== undefined && event.name === "d") parameters.remove(here);
      else if (event.name === "up" || event.name === "k") at = Math.max(0, at - 1);
      else if (event.name === "down" || event.name === "j") at = Math.min(all.length - 1, at + 1);
      else if (["left", "right", "h", "l"].includes(event.name)) {
        const name = all[at];
        const values = name === undefined ? undefined : view.choices[name];
        if (name === undefined || !values) return true;
        const current = selected(view)[name] as string;
        const step = event.name === "right" || event.name === "l" ? 1 : -1;
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
