import type { Selection } from "../../config/parameters";
import { effectiveSelection, type ParameterChoices } from "../../config/parameters";
import { DASHBOARD_INTERVAL_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../../constants";
import type { InputEvent } from "../../tui/input";
import { columns, fill, type Rect, rows } from "../../tui/layout";
import { type ListGeometry, listKey, listMouse } from "../../tui/list";
import { ModalStack } from "../../tui/modal";
import type { Screen } from "../../tui/screen";
import { drawField, fieldKey, fieldValue, type TextField, textField } from "../../tui/textfield";
import { defaultTheme as t } from "../../tui/theme";
import {
  box,
  type Cell,
  graph,
  meter,
  scrollTo,
  sparkline,
  spinner,
  table,
  tabs,
} from "../../tui/widgets";
import { pad } from "../../tui/width";
import { type Command, keyCommand } from "../keymap";
import { fromEngineKey } from "../keys";
import type { DashboardSettings } from "../settings";
import type { Editor } from "./editor";
import { drawHelpBar, helpModal } from "./help";
import { LOCAL_ENVIRONMENT, type SeriesStats, statsOf, type Tracker } from "./history";
import { paletteModal } from "./palette";
import { detailPanel, optionsPanel, type Panel, parametersPanel } from "./panels";

/** Uptime the services are held to, in percent. Not configurable on purpose. */
export const SLO_PERCENT = 99;
const SLO_RATIO = SLO_PERCENT / 100;
const GRAPH_MAX_MS = 300;
const ALL = "all";
const STATUS_MAX_WIDTH = 10;

export interface ViewState {
  /** Index of the active tab: 0 is "all", then one per environment. */
  tab: number;
  /** Followed by name, so a service keeps the selection while rows move. */
  selected?: string;
  offset: number;
  tableBody: Rect;
  frame: number;
  /** Name filter, typed after "/". Kept when the field is closed with Enter. */
  filter: TextField;
  filtering: boolean;
  modals: ModalStack;
  /** The whole screen, as of the last frame: modals are sized from it. */
  area: Rect;
  settings: DashboardSettings;
  /** Services of config.yml set aside by local.yml. */
  skipped: ReadonlySet<string>;
  /** Per-service timeout in seconds, as in config.yml; unset = the global one. */
  timeouts: Readonly<Record<string, number | undefined>>;
  selection: Selection;
  /** Every parameter the config declares, with its values. */
  choices: ParameterChoices;
  /** A line that replaces the help bar for a few seconds: the outcome of an action. */
  status?: { text: string; at: number };
  /** The bar of the keymap that fits the modal on top. */
  bar?: Panel["bar"];
  /** A command a modal chose and closed on: run once it is gone. */
  queued?: Command;
}

export type ViewInit = Partial<
  Pick<ViewState, "settings" | "skipped" | "timeouts" | "selection" | "choices">
>;

const STATUS_MS = 6000;

/** Show the outcome of an action in place of the bar. */
export function say(view: ViewState, text: string, at = Date.now()): void {
  view.status = { text, at };
}

export const initialView = (init: ViewInit = {}): ViewState => ({
  settings: {
    intervalMs: DASHBOARD_INTERVAL_SECONDS * 1000,
    timeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
  },
  skipped: new Set(),
  timeouts: {},
  selection: {},
  choices: {},
  ...init,
  tab: 0,
  offset: 0,
  tableBody: { x: 0, y: 0, w: 0, h: 0 },
  frame: 0,
  filter: textField(),
  filtering: false,
  modals: new ModalStack(),
  area: { x: 0, y: 0, w: 0, h: 0 },
});

const tabNames = (tracker: Tracker) => [ALL, ...tracker.environments];
const activeEnv = (tracker: Tracker, view: ViewState) =>
  view.tab === 0 ? undefined : tracker.environments[view.tab - 1];

export function visibleServices(tracker: Tracker, view: ViewState): string[] {
  const wanted = fieldValue(view.filter).toLowerCase();
  return tracker.services(activeEnv(tracker, view)).filter((n) => n.toLowerCase().includes(wanted));
}

export function selectedIndex(tracker: Tracker, view: ViewState): number {
  const list = visibleServices(tracker, view);
  const found = view.selected === undefined ? -1 : list.indexOf(view.selected);
  return list.length === 0 ? -1 : Math.max(0, found);
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);
const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

function statusCell(tracker: Tracker, service: string, env: string, skipped: boolean): Cell {
  if (skipped && env === LOCAL_ENVIRONMENT) return { text: "- skipped", style: { fg: t.muted } };
  const sample = tracker.history(service, env)?.last;
  if (!sample) return { text: "· -", style: { fg: t.muted } };
  return sample.ok
    ? { text: "● up", style: { fg: t.ok } }
    : { text: "● down", style: { fg: t.err, bold: true } };
}

/** Draws the whole screen from the state. No I/O: probes feed the tracker, input feeds the view. */
export function renderDashboard(
  screen: Screen,
  area: Rect,
  tracker: Tracker,
  view: ViewState,
  now = Date.now(),
): void {
  view.area = area;
  const [header = area, body = area, filterRow = area, footer = area] = rows(area, [
    1,
    fill(),
    view.filtering ? 1 : 0,
    1,
  ]);
  const [left = body, right = body] = columns(body, ["55%", fill()]);
  const [graphArea = right, gaugeArea = right, logArea = right] = rows(right, [
    fill(2),
    4,
    fill(2),
  ]);
  const env = activeEnv(tracker, view);
  const list = visibleServices(tracker, view);
  const index = selectedIndex(tracker, view);
  const service = list[index];

  let x = screen.text(1, header.y, "probe", { fg: t.accent, bold: true }) + 3;
  x += tabs(
    screen,
    x,
    header.y,
    tabNames(tracker),
    view.tab,
    { fg: t.title, bg: t.selectedBg, bold: true },
    { fg: t.muted },
  );
  const picked = effectiveSelection(view.choices, view.selection);
  for (const [name, value] of Object.entries(picked)) {
    x += screen.text(x, header.y, `${name}:`, { fg: t.muted }) + 1;
    x += screen.text(x, header.y, value, { fg: t.accent, bold: true }) + 2;
  }
  const status = `${spinner(view.frame)} ${clock(now)}`;
  screen.text(area.w - status.length - 1, header.y, status, { fg: t.muted });

  const shown = env === undefined ? tracker.environments : [env];
  const statusWidth = (name: string) => Math.min(STATUS_MAX_WIDTH, Math.max(9, name.length));
  const inner = box(screen, left, {
    title: "services",
    hotkey: "¹ ",
    footer: filterNote(view, list.length),
    color: t.borderFocus,
    titleColor: t.title,
    hotkeyColor: t.accent,
  });
  const data: Cell[][] = list.map((name) => {
    const stats = statsOf(tracker.rings(name, env));
    const latencies = tracker
      .rings(name, env)
      .flatMap((ring) => ring.toArray().map((s) => s.latencyMs));
    return [
      name,
      ...shown.map((e) => statusCell(tracker, name, e, view.skipped.has(name))),
      {
        text: stats.last ? `${Math.round(stats.last.latencyMs)}ms` : "-",
        style: { fg: stats.last && !stats.last.ok ? t.err : t.fg },
      },
      {
        text: stats.checks ? percent(stats.uptime) : "-",
        style: { fg: stats.checks && stats.uptime < SLO_RATIO ? t.warn : t.fg },
      },
      { text: sparkline(latencies, 10, GRAPH_MAX_MS), style: { fg: t.accent } },
    ];
  });
  const padded = { ...inner, x: inner.x + 1, w: Math.max(0, inner.w - 2) };
  view.offset = scrollTo(Math.max(0, index), view.offset, padded.h - 1);
  view.tableBody = table(
    screen,
    padded,
    [
      { title: "service", width: fill() },
      ...shown.map((name) => ({ title: name, width: statusWidth(name) })),
      { title: "last", width: 7, align: "right" as const },
      { title: "uptime", width: 7, align: "right" as const },
      { title: "trend", width: 10 },
    ],
    data,
    {
      selected: index,
      offset: view.offset,
      header: { fg: t.muted, bold: true },
      row: { fg: t.fg },
      selectedBg: t.selectedBg,
    },
  );

  drawDetail(screen, { graphArea, gaugeArea }, tracker, service, env);
  drawEvents(screen, logArea, tracker, env);
  if (view.filtering) {
    const label = screen.text(1, filterRow.y, "filter ", { fg: t.accent, bold: true });
    view.filter = drawField(screen, 1 + label, filterRow.y, area.w - label - 2, view.filter, {
      fg: t.fg,
    });
  }
  const barScreen =
    view.modals.depth > 0
      ? ((view.modals.top as Partial<Panel> | undefined)?.bar ?? view.bar ?? "help")
      : view.filtering
        ? "filter"
        : "list";
  if (view.status && now - view.status.at < STATUS_MS) {
    const text = view.status.text.replaceAll("\n", " · ");
    screen.text(1, footer.y, text, { fg: t.warn }, area.w - 2);
  } else {
    drawHelpBar(screen, footer, {
      screen: barScreen,
      grid: tracker.environments.length > 1,
      parameters: Object.keys(view.choices).length > 0,
    });
  }
  view.modals.draw(screen, area);
}

function filterNote(view: ViewState, count: number): string {
  const text = fieldValue(view.filter);
  return text && !view.filtering ? `${count} services · filter: ${text}` : `${count} services`;
}

function drawDetail(
  screen: Screen,
  { graphArea, gaugeArea }: { graphArea: Rect; gaugeArea: Rect },
  tracker: Tracker,
  service: string | undefined,
  env: string | undefined,
): void {
  const focus =
    service === undefined
      ? undefined
      : (env ?? tracker.environments.find((e) => tracker.history(service, e)));
  const ring =
    service === undefined || focus === undefined ? undefined : tracker.history(service, focus);
  const series: SeriesStats = statsOf(ring ? [ring] : []);
  const g = box(screen, graphArea, {
    title: service === undefined ? "latency" : `latency · ${service}@${focus}`,
    footer: ring ? `p50 ${Math.round(series.p50)}ms  p95 ${Math.round(series.p95)}ms` : undefined,
    color: t.border,
    titleColor: t.title,
  });
  if (ring) {
    graph(
      screen,
      g,
      ring.toArray().map((s) => s.latencyMs),
      {
        gradient: t.latency,
        max: GRAPH_MAX_MS,
      },
    );
  }

  const h = box(screen, gaugeArea, {
    title: `uptime · SLO ${SLO_PERCENT}%`,
    color: t.border,
    titleColor: t.title,
  });
  const uptime = statsOf(service === undefined ? [] : tracker.rings(service, env));
  const value = uptime.checks ? percent(uptime.uptime) : "-";
  const barX = h.x + 1;
  const barWidth = Math.max(0, h.w - 10);
  meter(screen, barX, h.y, barWidth, uptime.uptime, { gradient: t.health, bg: t.meterBg });
  if (barWidth > 0)
    screen.set(barX + Math.min(barWidth - 1, Math.floor(SLO_RATIO * barWidth)), h.y, "┃", {
      fg: t.accent,
      bold: true,
    });
  const met = uptime.uptime >= SLO_RATIO;
  screen.text(h.x + h.w - 8, h.y, pad(value, 7, "right"), {
    fg: !uptime.checks ? t.muted : met ? t.ok : t.err,
    bold: true,
  });
  if (h.h > 1 && uptime.checks)
    screen.text(barX, h.y + 1, met ? "meets the SLO" : "below the SLO", { fg: met ? t.ok : t.err });
}

function drawEvents(screen: Screen, area: Rect, tracker: Tracker, env: string | undefined): void {
  const l = box(screen, area, { title: "events", color: t.border, titleColor: t.title });
  const entries = tracker.events
    .toArray()
    .filter((event) => env === undefined || event.env === env)
    .slice(-l.h)
    .reverse();
  entries.forEach((event, i) => {
    const y = l.y + i;
    let x = l.x + 1;
    x += screen.text(x, y, clock(event.at), { fg: t.muted }) + 1;
    x += screen.text(x, y, event.service, { fg: t.fg }) + 1;
    x += screen.text(x, y, event.env, { fg: t.muted }) + 1;
    const state = event.ok ? "UP" : `DOWN${event.detail ? ` (${event.detail})` : ""}`;
    screen.text(x, y, state, { fg: event.ok ? t.ok : t.err, bold: true }, l.x + l.w - 1 - x);
  });
}

/** What the screen cannot do itself: the checks, the files, the clipboard. */
export interface ViewActions {
  quit(): void;
  refresh(): void;
  open?(service: string, env: string): void;
  copy?(service: string, env: string): void;
  skip?(service: string, skip: boolean): void;
  timeout?(service: string, seconds: number | undefined): void;
  settings?(settings: DashboardSettings): void;
  parameter?(name: string, value: string): void;
  /** The keys that edit the files; absent when nothing can write them. */
  edit?: Editor;
}

/** The environment a service is looked at in: the tab's, or the first one that has it. */
export function focusEnv(tracker: Tracker, view: ViewState, service: string): string | undefined {
  return (
    activeEnv(tracker, view) ??
    tracker.environments.find((e) => tracker.history(service, e) || tracker.result(service, e))
  );
}

/** Applies one input event to the view. */
export function handleInput(
  event: InputEvent,
  tracker: Tracker,
  view: ViewState,
  actions: ViewActions,
): void {
  if (view.modals.depth > 0) {
    const typing = view.modals.top?.typing === true;
    if (event.kind === "key" && event.name === "q" && !event.ctrl && !event.alt && !typing)
      actions.quit();
    else view.modals.handle(event);
    if (view.modals.depth === 0) view.bar = undefined;
    const queued = view.queued;
    view.queued = undefined;
    if (queued) runCommand(queued, tracker, view, actions);
    return;
  }
  const list = visibleServices(tracker, view);
  const geometry: ListGeometry = { count: list.length, body: view.tableBody };
  const select = (next: { selected: number; offset: number }) => {
    if (list.length === 0) return;
    view.selected = list[next.selected];
    view.offset = next.offset;
  };
  const current = { selected: Math.max(0, selectedIndex(tracker, view)), offset: view.offset };
  if (event.kind === "mouse") {
    select(listMouse(current, event, geometry));
    return;
  }
  if (view.filtering) {
    typeFilter(event, view, () => select(listKey(current, event, geometry)));
    return;
  }
  if (event.ctrl || event.alt) return;
  const environments = tabNames(tracker).length;
  const cycle = (by: number) => {
    view.tab = (view.tab + by + environments) % environments;
    view.offset = 0;
  };
  if (event.name === "escape") {
    if (fieldValue(view.filter)) view.filter = textField();
    else actions.quit();
    return;
  }
  const typed = fromEngineKey(event).input;
  const command = event.name === "enter" ? keyCommand("", true) : keyCommand(typed, false);
  if (command) runCommand(command, tracker, view, actions);
  else if (typed === ":") openPalette(view);
  else if (event.name === "tab") cycle(event.shift ? -1 : 1);
  else if (event.name === "right" || event.name === "l") cycle(1);
  else if (event.name === "left" || event.name === "h") cycle(-1);
  else select(listKey(current, event, geometry));
}

const openPalette = (view: ViewState) =>
  view.modals.push(
    paletteModal((command) => {
      view.queued = command;
    }),
  );

/** The service the cursor is on, if the list has any. */
function selectedService(tracker: Tracker, view: ViewState): string | undefined {
  return visibleServices(tracker, view)[Math.max(0, selectedIndex(tracker, view))];
}

/** What a command of the keymap does: the keys and the palette both come here. */
export function runCommand(
  command: Command,
  tracker: Tracker,
  view: ViewState,
  actions: ViewActions,
): void {
  const service = selectedService(tracker, view);
  const env = service === undefined ? undefined : focusEnv(tracker, view, service);
  const elsewhere = actions.edit?.elsewhere(activeEnv(tracker, view));
  const edit = (act: (editor: Editor, name: string) => void) => {
    if (elsewhere) say(view, elsewhere);
    else if (actions.edit && service !== undefined) act(actions.edit, service);
  };
  switch (command) {
    case "check":
      actions.refresh();
      break;
    case "quit":
      actions.quit();
      break;
    case "help":
      view.modals.push(helpModal(view.area, tabNames(tracker).length > 2));
      break;
    case "filter":
      view.filtering = true;
      break;
    case "options":
      view.modals.push(optionsPanel(view, actions));
      break;
    case "parameters":
      if (Object.keys(view.choices).length === 0) say(view, "no parameters in this config");
      else view.modals.push(parametersPanel(view, actions));
      break;
    case "detail":
      if (service !== undefined && env !== undefined)
        view.modals.push(detailPanel(view.area, tracker, view, service, env, actions));
      break;
    case "open":
    case "copy":
      if (service !== undefined && env !== undefined)
        (command === "open" ? actions.open : actions.copy)?.(service, env);
      break;
    case "add":
      if (elsewhere) say(view, elsewhere);
      else actions.edit?.add();
      break;
    case "edit":
      edit((editor, name) => editor.edit(name));
      break;
    case "remove":
      edit((editor, name) => editor.remove(name));
      break;
    case "undo":
    case "redo":
      if (elsewhere) say(view, elsewhere);
      else actions.edit?.[command]();
      break;
    default:
      command satisfies never;
  }
}

function typeFilter(event: InputEvent, view: ViewState, move: () => void): void {
  if (event.kind !== "key") return;
  if (event.name === "escape") {
    view.filter = textField();
    view.filtering = false;
  } else if (event.name === "enter") view.filtering = false;
  else if (event.name === "up" || event.name === "down") move();
  else view.filter = fieldKey(view.filter, event);
}
