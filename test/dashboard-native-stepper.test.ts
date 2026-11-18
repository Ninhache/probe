import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { helpBarItems } from "../src/dashboard/keymap";
import { Tracker } from "../src/dashboard/native/history";
import { reachAt } from "../src/dashboard/native/stepper";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewInit,
} from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;

const answered = {
  name: "api",
  type: "http",
  ok: true,
  target: "http://x",
  latencyMs: 1,
} as CheckResult;

function setup(init: ViewInit = {}) {
  const tracker = new Tracker(["local"]);
  tracker.record("local", [answered], 1);
  const view = initialView(init);
  const calls: string[] = [];
  const actions = {
    quit() {},
    refresh() {},
    parameter: (n: string, v: string) => calls.push(`${n}=${v}`),
    timeout: (_service: string, n: number | undefined) => calls.push(`timeout ${n}`),
  };
  const draw = (w = 110, h = 24) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (...names: string[]) => {
    for (const name of names) handleInput(key(name), tracker, view, actions);
  };
  draw();
  return { view, draw, press, calls };
}

const choices = { env: ["dev", "stage", "prod"], region: ["eu", "us"] };
const line = (text: string, label: string) =>
  text.split("\n").find((l) => l.includes("│") && l.includes(label)) ?? "";

describe("reach", () => {
  it("has no value before the first one nor after the last", () => {
    expect(reachAt(0, 3)).toEqual({ previous: false, next: true });
    expect(reachAt(1, 3)).toEqual({ previous: true, next: true });
    expect(reachAt(2, 3)).toEqual({ previous: true, next: false });
  });
});

describe("the parameters panel", () => {
  it("moves between parameters with up and down and changes the value with left and right", () => {
    const { press, view, calls } = setup({ choices });
    press("p", "right");
    expect(view.selection).toEqual({ env: "stage" });
    press("down", "right");
    expect(calls).toEqual(["env=stage", "region=us"]);
    press("up", "h");
    expect(calls.at(-1)).toBe("env=dev");
  });

  it("says so in the footer and the bar", () => {
    const { press, draw } = setup({ choices });
    press("p");
    const text = draw();
    expect(text).toContain("↑↓ parameter · ←→ value · esc");
    const bar = helpBarItems("choose", true, 200, false, true, true);
    expect(bar.find(({ action }) => action === "parameter")?.keys).toBe("↑↓ jk");
    const ink = helpBarItems("choose", true, 200, false, true);
    expect(ink.find(({ action }) => action === "parameter")?.keys).toBe("←→ hl");
  });

  it("draws a chevron only where the value can move", () => {
    const { press, draw } = setup({ choices });
    press("p");
    expect(line(draw(), "env")).toMatch(/ {2}dev ›/);
    press("right");
    expect(line(draw(), "env")).toContain("‹ stage ›");
    press("right");
    const last = line(draw(), "env");
    expect(last).toContain("‹ prod");
    expect(last).not.toContain("prod ›");
  });
});

describe("the options panel", () => {
  it("draws chevrons on the interval and the notification", () => {
    const { press, draw } = setup();
    press("o");
    const text = draw();
    expect(line(text, "Interval")).toMatch(/[‹›]/);
    expect(line(text, "Notify")).toContain("off ›");
    press("down", "down", "right");
    const on = line(draw(), "Notify");
    expect(on).toContain("‹ on");
    expect(on).not.toContain("on ›");
  });
});

describe("the timeout in the detail", () => {
  it("shows a way forward only from the default, and both in the middle", () => {
    const { press, draw } = setup();
    press("enter");
    const first = line(draw(), "timeout");
    expect(first).toContain("default ›");
    expect(first).not.toContain("‹");
    press("right");
    expect(line(draw(), "timeout")).toContain("‹ 1s ›");
  });
});
