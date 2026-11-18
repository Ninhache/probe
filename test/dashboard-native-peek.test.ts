import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { reference } from "../src/config/headers";
import { Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import { HTTP_ONLY } from "../src/dashboard/response";
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

const echo = reference("API_KEY");
const ROWS = 60;
const body = Array.from({ length: ROWS }, (_, i) => `row ${i}`).join("\n");

const http = (name: string, response: Partial<NonNullable<CheckResult["response"]>> = {}) =>
  ({
    name,
    type: "http",
    ok: true,
    target: `http://127.0.0.1:4101/${name}`,
    latencyMs: 12,
    status: 200,
    method: "GET",
    response: {
      statusText: "OK",
      headers: [
        ["content-type", "text/plain"],
        ["set-cookie", "(hidden)"],
        ["x-seen", `key ${echo}`],
      ],
      body,
      ...response,
    },
  }) satisfies CheckResult;

const tcp: CheckResult = { name: "db", type: "tcp", ok: true, target: "x:1", latencyMs: 1 };

function setup(...results: CheckResult[]) {
  const tracker = new Tracker(["local"]);
  tracker.record("local", results, 1);
  const view = initialView();
  const copied: [string, boolean, string | undefined][] = [];
  const actions: ViewActions = {
    quit() {},
    refresh() {},
    copyResponse: (text, cut, part) => copied.push([text, cut, part]),
  };
  const draw = (w = 110, h = 30) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (...names: string[]) => {
    for (const name of names) handleInput(key(name), tracker, view, actions);
  };
  const send = (event: InputEvent) => handleInput(event, tracker, view, actions);
  draw();
  return { tracker, view, draw, press, send, copied };
}

describe("the tabs of the box under the graph", () => {
  it("opens on the log and names both tabs in its border", () => {
    const { draw, view } = setup(http("api"));
    const text = draw();

    expect(text).toContain("1 log");
    expect(text).toContain("2 response");
    expect(view.bottom).toBe("log");
    expect(text).not.toContain("HTTP/1.1 200 OK");
  });

  it("switches with 2 and 1, and keeps the tab across redraws", () => {
    const { press, draw, view } = setup(http("api"));
    press("2");
    expect(draw()).toContain("HTTP/1.1 200 OK");
    expect(draw()).toContain("HTTP/1.1 200 OK");

    press("1");
    expect(view.bottom).toBe("log");
    expect(draw()).not.toContain("HTTP/1.1 200 OK");
  });

  it("switches with a click on a title", () => {
    const { send, draw, view } = setup(http("api"));
    const [logTab, response] = view.bottomTitles;
    if (!logTab || !response) throw new Error("no title drawn");

    send(mouse("press", response.x + 2, view.bottomBox.y));
    expect(view.bottom).toBe("response");
    expect(draw()).toContain("HTTP/1.1 200 OK");

    send(mouse("press", logTab.x + 2, view.bottomBox.y));
    expect(view.bottom).toBe("log");
  });

  it("does not take a click that is not on a title", () => {
    const { send, view } = setup(http("api"));
    send(mouse("press", view.bottomBox.x + view.bottomBox.w - 2, view.bottomBox.y));

    expect(view.bottom).toBe("log");
  });
});

describe("the response tab", () => {
  it("shows the status line, the masked header, the echoed secret as its name and the body", () => {
    const { press, draw } = setup(http("api"));
    press("2");
    const text = draw();

    expect(text).toContain("HTTP/1.1 200 OK");
    expect(text).toContain("set-cookie: (hidden)");
    expect(text).toContain(`x-seen: key ${echo}`);
    expect(text).toContain("row 0");
  });

  it("follows the selected service", () => {
    const { press, draw } = setup(
      http("api", { statusText: "First", body: "alpha" }),
      http("web", { statusText: "Second", body: "beta" }),
    );
    press("2");
    expect(draw()).toContain("200 First");

    press("down");
    const text = draw();
    expect(text).toContain("200 Second");
    expect(text).toContain("beta");
  });

  it("updates when a new check comes in", () => {
    const { press, draw, tracker } = setup(http("api", { statusText: "Before" }));
    press("2");
    expect(draw()).toContain("200 Before");

    tracker.record("local", [http("api", { statusText: "After" })], 2);
    expect(draw()).toContain("200 After");
  });

  it("says it is HTTP-only for another type and shows its detail", () => {
    const { press, draw } = setup(tcp);
    press("2");
    const text = draw();

    expect(text).toContain(HTTP_ONLY);
    expect(text).toContain("up · 1ms");
  });

  it("scrolls with PgDn and the wheel without taking the arrows from the list", () => {
    const { press, draw, send, view } = setup(http("api"), http("web"));
    press("2");
    expect(draw()).not.toContain("row 40");

    press("pagedown");
    expect(view.bottomTop).toBeGreaterThan(0);
    const after = view.bottomTop;
    expect(view.selected).toBeUndefined();

    send(mouse("wheel-down", view.bottomBox.x + 3, view.bottomBox.y + 2));
    expect(view.bottomTop).toBeGreaterThan(after);
    send(mouse("wheel-up", view.bottomBox.x + 3, view.bottomBox.y + 2));
    press("pageup");
    expect(view.bottomTop).toBe(0);

    press("down");
    expect(view.selected).toBe("web");
  });

  it("starts at the top again for another service", () => {
    const { press, draw, view } = setup(http("api"), http("web"));
    press("2");
    draw();
    press("pagedown");
    expect(view.bottomTop).toBeGreaterThan(0);

    press("down");
    draw();
    expect(view.bottomTop).toBe(0);
  });

  it("offers u, b and the tab in the bar", () => {
    const { press, draw } = setup(http("api"));
    press("2");
    const last = draw(140, 30).split("\n").at(-1) ?? "";

    expect(last).toContain("u open");
    expect(last).toContain("b copy body");
  });
});

describe("copying the body", () => {
  it("copies only the body from the list", () => {
    const { press, copied } = setup(http("api", { body: "hello" }));
    press("b");

    expect(copied).toEqual([["hello", false, "body"]]);
  });

  it("copies the body as it is on screen: the echoed secret stays a name", () => {
    const { press, copied } = setup(http("api", { body: `token ${echo}` }));
    press("2", "b");

    expect(copied).toEqual([[`token ${echo}`, false, "body"]]);
    expect(copied[0]?.[0]).not.toContain("set-cookie");
  });

  it("says when the body was cut", () => {
    const { press, copied } = setup(http("api", { body: "part", bodyCut: true }));
    press("b");

    expect(copied).toEqual([["part", true, "body"]]);
  });

  it("copies the body from the full response view too", () => {
    const { press, copied } = setup(http("api", { body: "hello" }));
    press("enter", "r", "b");

    expect(copied).toEqual([["hello", false, "body"]]);
  });

  it("says why there is nothing to copy", () => {
    const empty = setup(http("api", { body: undefined }));
    empty.press("b");
    expect(empty.view.status?.text).toContain("no body");

    const other = setup(tcp);
    other.press("b");
    expect(other.view.status?.text).toBe(HTTP_ONLY);
    expect(other.copied).toEqual([]);
  });
});
