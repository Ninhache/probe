import type { InputEvent } from "../../tui/input";
import { columns, contains, fill, type Rect, rows } from "../../tui/layout";
import type { Screen } from "../../tui/screen";
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
import { type SeriesStats, statsOf, type Tracker } from "./history";

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
}

export const initialView = (): ViewState => ({
  tab: 0,
  offset: 0,
  tableBody: { x: 0, y: 0, w: 0, h: 0 },
  frame: 0,
});

const tabNames = (tracker: Tracker) => [ALL, ...tracker.environments];
const activeEnv = (tracker: Tracker, view: ViewState) =>
  view.tab === 0 ? undefined : tracker.environments[view.tab - 1];

export function visibleServices(tracker: Tracker, view: ViewState): string[] {
  return tracker.services(activeEnv(tracker, view));
}

export function selectedIndex(tracker: Tracker, view: ViewState): number {
  const list = visibleServices(tracker, view);
  const found = view.selected === undefined ? -1 : list.indexOf(view.selected);
  return list.length === 0 ? -1 : Math.max(0, found);
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);
const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

function statusCell(tracker: Tracker, service: string, env: string): Cell {
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
  const [header = area, body = area, footer = area] = rows(area, [1, fill(), 1]);
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
  const status = `${spinner(view.frame)} ${clock(now)}`;
  screen.text(area.w - status.length - 1, header.y, status, { fg: t.muted });

  const shown = env === undefined ? tracker.environments : [env];
  const statusWidth = (name: string) => Math.min(STATUS_MAX_WIDTH, Math.max(6, name.length));
  const inner = box(screen, left, {
    title: "services",
    hotkey: "¹ ",
    footer: `${list.length} services`,
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
      ...shown.map((e) => statusCell(tracker, name, e)),
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
  drawHints(screen, footer);
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

function drawHints(screen: Screen, footer: Rect): void {
  const hints: [string, string][] = [
    ["j/k", "select"],
    ["tab", "environment"],
    ["r", "check now"],
    ["q", "quit"],
  ];
  let x = 1;
  for (const [key, label] of hints) {
    x += screen.text(x, footer.y, key, { fg: t.accent, bold: true }) + 1;
    x += screen.text(x, footer.y, label, { fg: t.muted }) + 2;
  }
}

export interface ViewActions {
  quit(): void;
  refresh(): void;
}

/** Applies one input event to the view. */
export function handleInput(
  event: InputEvent,
  tracker: Tracker,
  view: ViewState,
  actions: ViewActions,
): void {
  const list = visibleServices(tracker, view);
  const move = (delta: number) => {
    if (list.length === 0) return;
    const next = Math.max(0, Math.min(list.length - 1, selectedIndex(tracker, view) + delta));
    view.selected = list[next];
  };
  if (event.kind === "mouse") {
    if (event.action === "wheel-up") move(-1);
    else if (event.action === "wheel-down") move(1);
    else if (
      event.action === "press" &&
      event.button === "left" &&
      contains(view.tableBody, event.x, event.y)
    ) {
      const picked = list[view.offset + event.y - view.tableBody.y];
      if (picked !== undefined) view.selected = picked;
    }
    return;
  }
  if (event.ctrl || event.alt) return;
  if (event.name === "q" || event.name === "escape") actions.quit();
  else if (event.name === "up" || event.name === "k") move(-1);
  else if (event.name === "down" || event.name === "j") move(1);
  else if (event.name === "tab") {
    const count = tabNames(tracker).length;
    view.tab = (view.tab + (event.shift ? count - 1 : 1)) % count;
    view.offset = 0;
  } else if (event.name === "r") actions.refresh();
}
