import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { percentile, Ring, statsOf, Tracker } from "../src/dashboard/native/history";
import { Monitor } from "../src/dashboard/native/monitor";
import {
  handleInput,
  initialView,
  renderDashboard,
  SLO_PERCENT,
  selectedIndex,
  visibleServices,
} from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const result = (name: string, ok: boolean, latencyMs = 10, error?: string): CheckResult => ({
  name,
  type: "http",
  ok,
  target: "http://example.com",
  latencyMs,
  error,
});

const key = (name: string, extra: Partial<InputEvent> = {}): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name, ...extra }) as InputEvent;
const click = (x: number, y: number): InputEvent => ({
  kind: "mouse",
  action: "press",
  button: "left",
  x,
  y,
  raw: "",
});
const actions = () => {
  const calls = { quit: 0, refresh: 0 };
  return { calls, quit: () => void calls.quit++, refresh: () => void calls.refresh++ };
};

function sample() {
  const tracker = new Tracker(["local", "prod"]);
  tracker.record("local", [result("acme", true, 12), result("globex", true, 40)], 1000);
  tracker.record("prod", [result("acme", true, 30), result("initech", false, 0, "refused")], 1000);
  return tracker;
}

describe("history", () => {
  it("keeps a bounded ring", () => {
    const ring = new Ring<number>(3);
    for (const n of [1, 2, 3, 4]) ring.push(n);
    expect(ring.toArray()).toEqual([2, 3, 4]);
    expect(ring.last).toBe(4);
  });

  it("computes percentiles and uptime", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10, 20, 30, 40], 50)).toBe(30);
    const tracker = new Tracker(["local"]);
    tracker.record("local", [result("acme", true, 10)], 1);
    tracker.record("local", [result("acme", false, 20)], 2);
    tracker.record("local", [result("acme", true, 30)], 3);
    tracker.record("local", [result("acme", true, 40)], 4);
    const stats = statsOf(tracker.rings("acme"));
    expect(stats.uptime).toBe(0.75);
    expect(stats.checks).toBe(4);
    expect(stats.last?.latencyMs).toBe(40);
  });

  it("logs only up/down transitions", () => {
    const tracker = new Tracker(["local"]);
    tracker.record("local", [result("acme", true)], 1);
    tracker.record("local", [result("acme", true)], 2);
    tracker.record("local", [result("acme", false, 0, "timeout")], 3);
    tracker.record("local", [result("acme", false, 0, "timeout")], 4);
    tracker.record("local", [result("acme", true)], 5);
    expect(tracker.events.toArray().map((e) => [e.at, e.ok, e.detail])).toEqual([
      [3, false, "timeout"],
      [5, true, undefined],
    ]);
  });

  it("logs a service that starts down, lists skipped ones without events", () => {
    const tracker = new Tracker(["local"]);
    tracker.record(
      "local",
      [result("acme", false, 0, "refused"), { ...result("globex", true), skipped: true }],
      1,
    );
    expect(tracker.events.toArray()).toHaveLength(1);
    expect(tracker.services()).toEqual(["acme", "globex"]);
  });

  it("marks an environment that cannot be read as down", () => {
    const tracker = sample();
    tracker.recordFailure("prod", "bad yaml", 2000);
    expect(tracker.history("acme", "prod")?.last).toMatchObject({ ok: false, detail: "bad yaml" });
  });
});

describe("monitor", () => {
  it("reports results and failures, and does not overlap runs", async () => {
    const seen: string[] = [];
    let running = 0;
    let overlap = false;
    const monitor = new Monitor(
      [
        {
          name: "slow",
          run: async () => {
            running++;
            overlap ||= running > 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            running--;
            return [result("acme", true)];
          },
        },
        { name: "broken", run: async () => Promise.reject(new Error("boom")) },
      ],
      {
        intervalMs: 1000,
        onResults: (env) => void seen.push(`ok:${env}`),
        onFailure: (env, message) => void seen.push(`fail:${env}:${message}`),
      },
    );
    monitor.refresh();
    monitor.refresh();
    await new Promise((resolve) => setTimeout(resolve, 60));
    monitor.stop();
    expect(overlap).toBe(false);
    expect(seen.sort()).toEqual(["fail:broken:boom", "ok:slow"]);
  });

  it("aborts in-flight checks on stop", async () => {
    let aborted = false;
    const monitor = new Monitor(
      [
        {
          name: "x",
          run: (signal) =>
            new Promise((_, reject) =>
              signal.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("aborted"));
              }),
            ),
        },
      ],
      { intervalMs: 1000, onResults: () => {}, onFailure: () => expect.unreachable() },
    );
    monitor.start();
    monitor.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(aborted).toBe(true);
  });
});

describe("dashboard view", () => {
  it("draws the boxes, the table, the gauge and the log", () => {
    const tracker = sample();
    const screen = new Screen(110, 28, "none");
    renderDashboard(
      screen,
      { x: 0, y: 0, w: 110, h: 28 },
      tracker,
      initialView(),
      Date.UTC(2026, 0, 1),
    );
    const text = screen.toPlainText();
    expect(text).toContain("╭─┤¹ services├");
    expect(text).toContain("┤latency · acme@local├");
    expect(text).toContain(`┤uptime · SLO ${SLO_PERCENT}%├`);
    expect(text).toContain("┤events├");
    expect(text).toMatch(/all\s+local\s+prod/);
    expect(text).toMatch(/acme\s+● up\s+● up/);
    expect(text).toMatch(/initech\s+· -\s+● down/);
    expect(text).toMatch(/initech prod DOWN \(refused\)/);
    expect(text).toContain("100.0%");
  });

  it("is a pure function of its inputs: a second frame flushes to nothing", () => {
    const tracker = sample();
    const view = initialView();
    const screen = new Screen(100, 24, "none");
    const draw = () => {
      screen.clear();
      renderDashboard(screen, { x: 0, y: 0, w: 100, h: 24 }, tracker, view, 0);
    };
    draw();
    screen.flush();
    draw();
    expect(screen.flush()).toBe("");
  });

  it("flags a service below the SLO", () => {
    const tracker = new Tracker(["local"]);
    for (let i = 0; i < 9; i++) tracker.record("local", [result("acme", true)], i);
    tracker.record("local", [result("acme", false, 0, "503")], 9);
    const screen = new Screen(100, 24, "none");
    renderDashboard(screen, { x: 0, y: 0, w: 100, h: 24 }, tracker, initialView(), 0);
    expect(screen.toPlainText()).toContain("90.0%");
    expect(screen.toPlainText()).toContain("below the SLO");
  });

  it("filters by environment with tab, and wraps", () => {
    const tracker = sample();
    const view = initialView();
    const a = actions();
    expect(visibleServices(tracker, view)).toEqual(["acme", "globex", "initech"]);
    handleInput(key("tab"), tracker, view, a);
    expect(visibleServices(tracker, view)).toEqual(["acme", "globex"]);
    handleInput(key("tab"), tracker, view, a);
    expect(visibleServices(tracker, view)).toEqual(["acme", "initech"]);
    handleInput(key("tab"), tracker, view, a);
    expect(view.tab).toBe(0);
    handleInput(key("tab", { shift: true }), tracker, view, a);
    expect(view.tab).toBe(2);
  });

  it("moves the selection with j/k/arrows and clamps it", () => {
    const tracker = sample();
    const view = initialView();
    const a = actions();
    for (const name of ["j", "down", "down", "down"]) handleInput(key(name), tracker, view, a);
    expect(view.selected).toBe("initech");
    handleInput(key("k"), tracker, view, a);
    handleInput(key("up"), tracker, view, a);
    handleInput(key("up"), tracker, view, a);
    expect(selectedIndex(tracker, view)).toBe(0);
  });

  it("quits on q and escape, refreshes on r", () => {
    const tracker = sample();
    const a = actions();
    handleInput(key("q"), tracker, initialView(), a);
    handleInput(key("escape"), tracker, initialView(), a);
    handleInput(key("r"), tracker, initialView(), a);
    expect(a.calls).toEqual({ quit: 2, refresh: 1 });
  });

  it("selects the clicked service row", () => {
    const tracker = sample();
    const view = initialView();
    const screen = new Screen(110, 28, "none");
    renderDashboard(screen, { x: 0, y: 0, w: 110, h: 28 }, tracker, view);
    const { x, y } = view.tableBody;
    handleInput(click(x + 3, y + 2), tracker, view, actions());
    expect(view.selected).toBe("initech");
    handleInput(click(x + 3, y + 20), tracker, view, actions());
    expect(view.selected).toBe("initech");
    handleInput(click(0, 0), tracker, view, actions());
    expect(view.selected).toBe("initech");
  });

  it("shows nothing selected on an empty dashboard without crashing", () => {
    const tracker = new Tracker(["local"]);
    const screen = new Screen(80, 20, "none");
    renderDashboard(screen, { x: 0, y: 0, w: 80, h: 20 }, tracker, initialView());
    handleInput(key("j"), tracker, initialView(), actions());
    expect(screen.toPlainText()).toContain("0 services");
  });
});

describe("help bar, help overlay and filter", () => {
  const draw = (tracker: Tracker, view = initialView(), w = 100, h = 30) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText().split("\n");
  };
  const run = (tracker: Tracker, view: ReturnType<typeof initialView>, ...names: string[]) => {
    for (const name of names) handleInput(key(name), tracker, view, actions());
  };

  it("draws the keymap's bar at the bottom and drops bindings when narrow", () => {
    const wide = draw(sample()).at(-1) ?? "";
    expect(wide).toContain("↑↓ jk move");
    expect(wide).toContain("/ filter");
    const narrow = draw(sample(), initialView(), 70, 16).at(-1) ?? "";
    expect(narrow.trim().length).toBeLessThan(wide.trim().length);
    expect(narrow).toContain("q quit");
    expect(narrow).not.toContain(": commands");
  });

  it("opens the help modal on ? and closes it with Esc, with the bar following", () => {
    const tracker = sample();
    const view = initialView();
    draw(tracker, view);
    run(tracker, view, "?");
    const rows = draw(tracker, view);
    expect(rows.join("\n")).toContain("┤help├");
    expect(rows.join("\n")).toContain("Filter by name");
    expect(rows.at(-1)).toContain("? esc close");
    run(tracker, view, "j", "escape");
    expect(view.modals.depth).toBe(0);
    expect(view.selected).toBeUndefined();
    expect(draw(tracker, view).join("\n")).not.toContain("┤help├");
  });

  it("quits from the help modal and does not leak other keys to the list", () => {
    const tracker = sample();
    const view = initialView();
    draw(tracker, view);
    run(tracker, view, "?");
    const a = actions();
    handleInput(key("q"), tracker, view, a);
    handleInput(key("r"), tracker, view, a);
    expect(a.calls).toEqual({ quit: 1, refresh: 0 });
  });

  it("filters services by name after /, keeps it on Enter and clears it on Esc", () => {
    const tracker = sample();
    const view = initialView();
    draw(tracker, view);
    run(tracker, view, "/", "g", "l");
    expect(visibleServices(tracker, view)).toEqual(["globex"]);
    expect(draw(tracker, view).at(-2)).toContain("filter gl");
    expect(draw(tracker, view).at(-1)).toContain("↵ keep");
    run(tracker, view, "enter");
    expect(view.filtering).toBe(false);
    expect(draw(tracker, view).join("\n")).toContain("1 services · filter: gl");
    run(tracker, view, "backspace");
    expect(view.filtering).toBe(false);
    run(tracker, view, "/", "escape");
    expect(visibleServices(tracker, view)).toHaveLength(3);
  });

  it("types q and other command keys into the filter instead of running them", () => {
    const tracker = sample();
    const view = initialView();
    const a = actions();
    for (const name of ["/", "q", "r"]) handleInput(key(name), tracker, view, a);
    expect(a.calls).toEqual({ quit: 0, refresh: 0 });
    expect(visibleServices(tracker, view)).toEqual([]);
  });
});
