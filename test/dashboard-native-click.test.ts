import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { DOUBLE_CLICK_MS } from "../src/constants";
import { paletteEntries } from "../src/dashboard/keymap";
import { Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
  type ViewState,
} from "../src/dashboard/native/view";
import { HitMap, registerHints } from "../src/tui/hits";
import { coalesceMoves, type InputEvent, parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const W = 160;
const H = 34;

const click = (
  x: number,
  y: number,
  action: "press" | "release" | "drag" | "move" | "wheel-up" | "wheel-down" = "press",
  button: "left" | "right" | "none" = action === "press" ? "left" : "none",
): InputEvent => ({ kind: "mouse", action, button, x, y, raw: "" });
const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;

const http = (name: string, ok = true): CheckResult => ({
  name,
  type: "http",
  ok,
  target: `http://127.0.0.1:4101/${name}`,
  latencyMs: 5,
  status: ok ? 200 : 503,
  method: "GET",
  response: { statusText: "OK", headers: [], body: `body of ${name}` },
});

function setup(init: Partial<ViewState> = {}, environments = ["local"]) {
  const tracker = new Tracker(environments);
  for (const env of environments) {
    tracker.record(env, [http("api"), http("web", false)], 1);
  }
  const view = initialView({ choices: { zone: ["eu", "us"] }, ...init });
  const calls: string[] = [];
  const actions: ViewActions = {
    quit: () => calls.push("quit"),
    refresh: () => calls.push("refresh"),
    open: (service) => calls.push(`open ${service}`),
    parameter: (name, value) => calls.push(`${name}=${value}`),
  };
  const draw = (ascii = false, mode: "truecolor" | "none" = "truecolor") => {
    const screen = new Screen(W, H, mode);
    screen.ascii = ascii;
    renderDashboard(screen, { x: 0, y: 0, w: W, h: H }, tracker, view, 0);
    return screen;
  };
  const send = (event: InputEvent) => {
    const frame = handleInput(event, tracker, view, actions);
    draw();
    return frame;
  };
  draw();
  const hit = (input: string, row = H - 1) =>
    view.hits.toArray().find((h) => h.action === "key" && h.input === input && h.y === row);
  return { tracker, view, calls, draw, send, hit };
}

afterEach(() => vi.useRealTimers());

describe("hint regions", () => {
  it("should register the keys of a hint, and the label of a lone key with it", () => {
    const hits = new HitMap();
    registerHints(hits, 10, 3, "↑↓ move · p parameters · PgUp PgDn scroll · esc");

    expect(hits.toArray().map(({ x, w, input }) => [x, w, input])).toEqual([
      [10, 1, "\x1b[A"],
      [11, 1, "\x1b[B"],
      [20, 12, "p"],
      [35, 4, "\x1b[5~"],
      [40, 4, "\x1b[6~"],
      [54, 3, "\x1b"],
    ]);
  });

  it("should not register a word that is not a key, or what is past the cut", () => {
    const hits = new HitMap();
    registerHints(hits, 0, 0, "jk move · a add", 12);

    expect(hits.toArray().map(({ input }) => input)).toEqual(["a"]);
    expect(hits.at(11, 0, 0)).toBeDefined();
    expect(hits.at(12, 0, 0)).toBeUndefined();
  });

  it("should reuse its regions from one frame to the next", () => {
    const { view, draw } = setup();
    const first = view.hits.count;
    for (let i = 0; i < 3; i++) draw();

    expect(view.hits.count).toBe(first);
    expect(first).toBeGreaterThan(5);
  });

  it("should only answer for the layer asked", () => {
    const hits = new HitMap();
    hits.add(0, 0, 3, "key", "a");
    hits.layer = 1;
    hits.add(0, 0, 3, "key", "b");

    expect(hits.at(1, 0, 0)?.input).toBe("a");
    expect(hits.at(1, 0, 1)?.input).toBe("b");
    expect(hits.at(1, 0, 2)).toBeUndefined();
  });
});

describe("a click on a hint", () => {
  it("should do what the key does: p in the footer opens the parameters", () => {
    const { send, hit, view } = setup();
    const p = hit("p");
    expect(p).toBeDefined();

    send(click((p?.x ?? 0) + 3, p?.y ?? 0));
    expect(view.modals.depth).toBe(1);
    expect(view.modals.top?.title).toBe("parameters");
  });

  it("should do the same for the label as for the key", () => {
    const { send, hit, view } = setup();
    const slash = hit("/");

    send(click((slash?.x ?? 0) + (slash?.w ?? 1) - 1, slash?.y ?? 0));
    expect(view.filtering).toBe(true);
  });

  it("should close a modal with the esc of its footer", () => {
    const { send, hit, view } = setup();
    send(key("?"));
    expect(view.modals.depth).toBe(1);
    const esc = view.hits.toArray().find((h) => h.input === "\x1b" && h.layer === 1);
    expect(esc).toBeDefined();

    send(click(esc?.x ?? 0, esc?.y ?? 0));
    expect(view.modals.depth).toBe(0);
    expect(hit("p")).toBeDefined();
  });

  it("should switch the tabs of the box, from the title", () => {
    const { send, view } = setup();
    const response = view.bottomTitles.find((title) => title.tab === "response");
    send(click((response?.x ?? 0) + 2, view.bottomBox.y));
    expect(view.bottom).toBe("response");

    const log = view.bottomTitles.find((title) => title.tab === "log");
    send(click((log?.x ?? 0) + 2, view.bottomBox.y));
    expect(view.bottom).toBe("log");
  });

  it("should switch the environment from its tab", () => {
    const { send, view, hits } = (() => {
      const s = setup({}, ["dev", "prod"]);
      return { ...s, hits: s.view.hits };
    })();
    const tab = hits.toArray().find((h) => h.action === "env" && h.ref === 2);

    send(click((tab?.x ?? 0) + 1, tab?.y ?? 0));
    expect(view.tab).toBe(2);
  });

  it("should turn changes only off from its marker in the log box", () => {
    const { send, view, hit } = setup();
    send(key("f"));
    expect(view.logChanges).toBe(true);
    const marker = hit("f", view.bottomBox.y + view.bottomBox.h - 1);
    expect(marker).toBeDefined();

    send(click(marker?.x ?? 0, marker?.y ?? 0));
    expect(view.logChanges).toBe(false);
  });

  it("should be ignored where the key would be: nothing happens in a text field's footer", () => {
    const { send, view, hit } = setup();
    send(key("/"));
    expect(view.filtering).toBe(true);
    const p = hit("p");

    send(click(p?.x ?? 0, p?.y ?? 0));
    expect(view.modals.depth).toBe(0);
  });

  it("should do nothing for a drag, a wheel, a release or another button", () => {
    const { send, view, hit, calls } = setup();
    const r = hit("/");
    const title = view.bottomTitles[1];
    const at = [r?.x ?? 0, r?.y ?? 0] as const;

    send(click(...at, "drag"));
    send(click(...at, "release"));
    send(click(...at, "wheel-down"));
    send(click(...at, "press", "right"));
    send(click((title?.x ?? 0) + 2, view.bottomBox.y, "wheel-down"));
    expect(calls).toEqual([]);
    expect(view.filtering).toBe(false);
    expect(view.bottom).toBe("log");
  });

  it("should work the same in ASCII", () => {
    const { view, draw } = setup();
    const unicode = view.hits.count;
    draw(true);

    expect(view.hits.count).toBe(unicode);
  });
});

describe("the topmost layer", () => {
  it("should swallow a click on what a modal covers or leaves around it", () => {
    const { send, view, hit, calls } = setup();
    const response = view.bottomTitles.find((title) => title.tab === "response");
    const p = hit("p");
    const r = hit("/");
    send(key("?"));
    const before = view.selected;

    send(click((response?.x ?? 0) + 2, view.bottomBox.y));
    send(click(r?.x ?? 0, r?.y ?? 0));
    send(click(view.tableBody.x + 2, view.tableBody.y + 1));
    send(click(p?.x ?? 0, p?.y ?? 0));

    expect(view.bottom).toBe("log");
    expect(calls).toEqual([]);
    expect(view.selected).toBe(before);
    expect(view.modals.top?.title).toBe("help");
  });
});

describe("the list", () => {
  it("should open the detail on a double-click on a service", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { send, view } = setup();
    const { x, y } = view.tableBody;

    send(click(x + 2, y));
    expect(view.modals.depth).toBe(0);
    vi.setSystemTime(1_000 + DOUBLE_CLICK_MS - 1);
    send(click(x + 2, y));
    expect(view.modals.depth).toBe(1);
  });

  it("should not take two slow clicks, or two rows, for a double-click", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { send, view } = setup();
    const { x, y } = view.tableBody;

    send(click(x + 2, y));
    vi.setSystemTime(1_000 + DOUBLE_CLICK_MS + 1);
    send(click(x + 2, y));
    send(click(x + 2, y + 1));
    expect(view.modals.depth).toBe(0);
  });

  it("should not take a double-click below the last service", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { send, view } = setup();
    const { x, y } = view.tableBody;

    send(click(x + 2, y + 10));
    send(click(x + 2, y + 10));
    expect(view.modals.depth).toBe(0);
  });

  it("should open the URL of a service from the detail, like u", () => {
    const { send, view, calls } = setup();
    send(key("enter"));
    expect(view.modals.top?.title).toContain("api");
    const url = view.hits.toArray().find((h) => h.input === "u" && h.layer === 1 && h.y < H - 2);
    expect(url).toBeDefined();

    send(click((url?.x ?? 0) + 1, url?.y ?? 0));
    expect(calls).toEqual(["open api"]);
  });
});

describe("a log line", () => {
  it("should select its service and show its response on a click", () => {
    const { send, view, draw } = setup();
    expect(view.logEntries.map((entry) => entry.service)).toEqual(["api", "web"]);
    const line = view.hits.toArray().find((h) => h.action === "log" && h.ref === 1);

    send(click((line?.x ?? 0) + 3, line?.y ?? 0));
    expect(view.selected).toBe("web");
    expect(view.bottom).toBe("response");
    expect(draw().toPlainText()).toContain("body of web");
  });

  it("should still scroll with the wheel over the lines", () => {
    const { tracker, send, view } = setup();
    for (let i = 0; i < 80; i++) tracker.record("local", [http("api")], i + 2);
    send(key("r"));
    const line = view.hits.toArray().find((h) => h.action === "log");

    send(click(line?.x ?? 0, line?.y ?? 0, "wheel-up"));
    expect(view.logFollow).toBe(false);
  });
});

describe("the click on a stepper and on a row of the palette", () => {
  it("should step a value from its chevron, like the arrow", () => {
    const { send, view, calls } = setup();
    send(key("p"));
    const next = view.hits.toArray().find((h) => h.layer === 1 && h.input.endsWith("\x1b[C"));
    expect(next).toBeDefined();

    send(click(next?.x ?? 0, next?.y ?? 0));
    expect(calls).toEqual(["zone=us"]);
  });

  it("should run the row that is clicked, whichever the cursor is on", () => {
    const { send, view, calls } = setup();
    send(key(":"));
    const at = paletteEntries(true, "").findIndex((entry) => entry.command === "check");
    const rows = view.hits
      .toArray()
      .filter((h) => h.layer === 1 && h.w > 20 && h.input.endsWith("\r"));
    expect(rows.length).toBe(paletteEntries(true, "").length);

    send(click((rows[at]?.x ?? 0) + 3, rows[at]?.y ?? 0));
    expect(calls).toEqual(["refresh"]);
    expect(view.modals.depth).toBe(0);
  });
});

describe("hover", () => {
  it("should read a motion with no button as a move, and a drag as a drag", () => {
    expect(parseInput("\x1b[<35;10;5M")[0]).toMatchObject({ action: "move", x: 9, y: 4 });
    expect(parseInput("\x1b[<32;10;5M")[0]).toMatchObject({ action: "drag", button: "left" });
  });

  it("should keep only the last of the moves read together", () => {
    const events = parseInput("\x1b[<35;1;1M\x1b[<35;2;1M\x1b[<0;2;1M\x1b[<35;3;1M\x1b[<35;4;1M");

    expect(
      coalesceMoves(events).map((e) => (e.kind === "mouse" ? `${e.action}${e.x}` : "")),
    ).toEqual(["move1", "press1", "move3"]);
  });

  it("should cost no frame to move inside a region, and one to cross into another", () => {
    const { send, hit, view } = setup();
    const a = hit("p");
    const b = hit("/");
    expect(a && b).toBeTruthy();

    let frames = send(click((a?.x ?? 0) + 1, a?.y ?? 0, "move")) ? 1 : 0;
    for (let i = 0; i < 1000; i++)
      if (send(click((a?.x ?? 0) + (i % (a?.w ?? 1)), a?.y ?? 0, "move"))) frames++;
    expect(frames).toBe(1);
    expect(view.hover?.input).toBe("p");

    expect(send(click(b?.x ?? 0, b?.y ?? 0, "move"))).toBe(true);
    expect(view.hover?.input).toBe("/");
  });

  it("should cost no frame to move over nothing, and one to leave a region", () => {
    const { send, hit } = setup();
    const a = hit("p");
    expect(send(click(0, 3, "move"))).toBe(false);
    send(click(a?.x ?? 0, a?.y ?? 0, "move"));
    expect(send(click(0, 3, "move"))).toBe(true);
    expect(send(click(1, 3, "move"))).toBe(false);
  });

  it("should draw the region under the pointer in reverse video, even without color", () => {
    for (const mode of ["truecolor", "none"] as const) {
      const { view, draw, hit } = setup();
      draw(false, mode);
      const a = hit("p");
      view.hover = a && { ...a };
      const hovered = draw(false, mode).flush();
      view.hover = undefined;
      const plain = draw(false, mode).flush();

      expect(hovered).toContain(";7m");
      expect(plain).not.toContain(";7m");
    }
  });

  it("should not light up the log lines", () => {
    const { send, view } = setup();
    const line = view.hits.toArray().find((h) => h.action === "log");
    expect(send(click(line?.x ?? 0, line?.y ?? 0, "move"))).toBe(false);
    expect(view.hover).toBeUndefined();
  });

  it("should forget the hover when a modal opens, a key is pressed, the window loses focus or the screen resizes", () => {
    const { send, view, hit, draw } = setup();
    const move = () => {
      const a = hit("p");
      send(click(a?.x ?? 0, a?.y ?? 0, "move"));
      expect(view.hover).toBeDefined();
    };
    move();
    send(key("?"));
    expect(view.hover).toBeUndefined();
    send(key("escape"));

    move();
    send(parseInput("\x1b[O")[0] as InputEvent);
    expect(view.hover).toBeUndefined();

    move();
    const screen = new Screen(W - 10, H, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w: W - 10, h: H }, setup().tracker, view, 0);
    expect(view.hover).toBeUndefined();
    draw();
  });

  it("should only light up what the topmost layer shows", () => {
    const { send, view, hit } = setup();
    const a = hit("p");
    send(key("?"));
    send(click(a?.x ?? 0, a?.y ?? 0, "move"));
    expect(view.hover?.layer ?? 1).toBe(1);
  });
});

describe("the environment tabs", () => {
  const header = (screen: Screen) => screen.toPlainText().split("\n")[0] ?? "";
  const tabHits = (view: ViewState) => view.hits.toArray().filter((h) => h.action === "env");

  it("should be hidden, and do nothing, with a single environment", () => {
    const { send, view, draw } = setup();

    expect(header(draw())).not.toMatch(/\ball\b|\blocal\b/);
    expect(tabHits(view)).toEqual([]);
    for (const name of ["tab", "right", "left", "l", "h"]) send(key(name));
    expect(view.tab).toBe(0);
    expect(header(draw())).not.toMatch(/\ball\b|\blocal\b/);
  });

  it("should come back with two environments, and answer to keys and clicks", () => {
    const { send, view, draw, tracker } = setup({}, ["local", "prod"]);

    expect(header(draw())).toMatch(/all\s+local\s+prod/);
    send(key("right"));
    expect(view.tab).toBe(1);
    const prod = tabHits(view).find((h) => h.ref === 2);
    send(click((prod?.x ?? 0) + 1, prod?.y ?? 0));
    expect(view.tab).toBe(2);
    expect(tracker.environments).toEqual(["local", "prod"]);
  });

  it("should appear when an environment is added to a single one", () => {
    const { tracker, view, draw } = setup();
    expect(tabHits(view)).toEqual([]);

    tracker.add("prod");
    expect(header(draw())).toMatch(/all\s+local\s+prod/);
    expect(tabHits(view).length).toBe(3);
  });
});
