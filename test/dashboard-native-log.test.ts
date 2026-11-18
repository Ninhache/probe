import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { LOG_PREVIEW_CHARS, LOG_SIZE } from "../src/constants";
import { bodyPreview, Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;
const mouse = (action: "press" | "wheel-up" | "wheel-down", x: number, y: number): InputEvent => ({
  kind: "mouse",
  action,
  button: action === "press" ? "left" : "none",
  x,
  y,
  raw: "",
});

const http = (name: string, body: string, ok = true): CheckResult => ({
  name,
  type: "http",
  ok,
  target: `http://127.0.0.1:4101/${name}`,
  latencyMs: 12,
  status: ok ? 200 : 503,
  method: "GET",
  ...(ok ? {} : { error: "HTTP 503" }),
  response: { statusText: ok ? "OK" : "Unavailable", headers: [], body },
});

function setup(environments = ["local"]) {
  const tracker = new Tracker(environments);
  const view = initialView();
  const copied: string[] = [];
  const actions: ViewActions = {
    quit() {},
    refresh() {},
    copyLog: (text) => copied.push(text),
  };
  const draw = (w = 110, h = 30) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (...names: string[]) => {
    for (const name of names) handleInput(key(name), tracker, view, actions);
  };
  draw();
  return {
    tracker,
    view,
    draw,
    press,
    copied,
    send: (e: InputEvent) => handleInput(e, tracker, view, actions),
  };
}

const many = (env: string, tracker: Tracker, count: number, from = 0) => {
  for (let i = from; i < from + count; i++) tracker.record(env, [http("api", `body ${i}`)], i);
};

describe("log tab", () => {
  it("should switch with 3 and with a click on its title", () => {
    const { draw, press, view, send } = setup();
    expect(draw()).toContain("3 log");

    press("3");
    expect(view.bottom).toBe("log");

    press("1");
    expect(view.bottom).toBe("events");
    draw();
    const title = view.bottomTitles.find((entry) => entry.tab === "log");
    send(mouse("press", (title?.x ?? 0) + 2, view.bottomBox.y));
    expect(view.bottom).toBe("log");
  });

  it("should show one line per result with status and body, newest last", () => {
    const { tracker, draw, press } = setup();
    tracker.record("local", [http("api", "first\n  body"), http("web", "down", false)], 1);
    tracker.record("local", [http("api", "second")], 2);
    press("3");

    const lines = draw().split("\n");
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(lines[at("first body")]).toContain("api local 200 first body");
    expect(lines[at("503 down")]).toContain("web local HTTP 503 down");
    expect(at("first body")).toBeLessThan(at("second"));
  });

  it("should follow the newest line until scrolled up, and End follows again", () => {
    const { tracker, draw, press, view } = setup();
    many("local", tracker, 100);
    press("3");
    expect(draw()).toContain("body 99");

    press("pageup");
    expect(view.logFollow).toBe(false);
    const away = draw();
    expect(away).not.toContain("body 99");

    many("local", tracker, 5, 100);
    expect(draw().replace(/\/\d+├/, "")).toBe(away.replace(/\/\d+├/, ""));

    press("end");
    expect(draw()).toContain("body 104");
  });

  it("should scroll with the wheel and follow again at the bottom", () => {
    const { tracker, draw, press, send, view } = setup();
    many("local", tracker, 100);
    press("3");
    draw();
    const { x, y } = view.bottomBox;

    send(mouse("wheel-up", x + 2, y + 2));
    expect(view.logFollow).toBe(false);

    press("pagedown", "pagedown", "pagedown", "pagedown");
    draw();
    expect(view.logFollow).toBe(true);
  });

  it("should filter by environment, and name the environment on the all tab", () => {
    const { tracker, draw, press, view } = setup(["dev", "prod"]);
    tracker.record("dev", [http("api", "from dev")], 1);
    tracker.record("prod", [http("api", "from prod")], 2);
    press("3");

    const all = draw();
    expect(all).toContain("api dev 200 from dev");
    expect(all).toContain("api prod 200 from prod");

    press("right");
    expect(view.tab).toBe(1);
    const dev = draw();
    expect(dev).toContain("api 200 from dev");
    expect(dev).not.toContain("from prod");
  });

  it("should remember at most LOG_SIZE lines", () => {
    const tracker = new Tracker(["local"]);
    many("local", tracker, LOG_SIZE + 50);

    expect(tracker.log.toArray()).toHaveLength(LOG_SIZE);
    expect(tracker.log.toArray()[0]?.preview).toBe("body 50");
  });

  it("should build the preview once, cut, without keeping the body", () => {
    let reads = 0;
    const result = http("api", "");
    const response = result.response as NonNullable<CheckResult["response"]>;
    Object.defineProperty(response, "body", {
      get() {
        reads += 1;
        return `x ${"y".repeat(10_000_000)}`;
      },
    });
    const { tracker, draw, press } = setup();
    tracker.record("local", [result], 1);
    press("3");
    for (let i = 0; i < 5; i++) draw();

    expect(reads).toBe(1);
    const [entry] = tracker.log.toArray();
    expect(entry?.preview.length).toBeLessThanOrEqual(LOG_PREVIEW_CHARS);
    expect(Object.keys(entry ?? {})).not.toContain("body");
  });

  it("should collapse whitespace and cut the preview", () => {
    expect(bodyPreview("  a \n\t b   c ")).toBe("a b c");
    expect(bodyPreview(`${" ".repeat(5000)}late`)).toBe("");
    expect(bodyPreview("z".repeat(1000))).toHaveLength(LOG_PREVIEW_CHARS);
    expect(bodyPreview(undefined)).toBe("");
  });

  it("should copy the visible lines as plain text with y", () => {
    const { tracker, draw, press, copied, view } = setup();
    tracker.record("local", [http("api", "one"), http("web", "two", false)], 1);
    press("3");
    draw();
    press("y");

    expect(copied).toHaveLength(1);
    expect(copied[0]?.split("\n")).toEqual([
      expect.stringMatching(/^\d\d:\d\d:\d\d api local 200 one$/),
      expect.stringMatching(/^\d\d:\d\d:\d\d web local HTTP 503 two$/),
    ]);
    expect(copied[0]).not.toContain("\u001b");
    expect(view.logShown).toHaveLength(2);
  });

  it("should not copy from another tab", () => {
    const { tracker, press, copied, view } = setup();
    tracker.record("local", [http("api", "one")], 1);
    press("y");

    expect(copied).toEqual([]);
    expect(view.status?.text).toContain("log tab");
  });

  it("should leave b and c on the last response", () => {
    const { tracker, press, view } = setup();
    tracker.record("local", [http("api", "one")], 1);
    press("3", "b");

    expect(view.status).toBeUndefined();
    expect(view.bottom).toBe("log");
  });
});
