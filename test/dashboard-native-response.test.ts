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
import { HTTP_ONLY, responseText } from "../src/dashboard/response";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;

const echo = reference("API_KEY");
const BODY_ROWS = 100;
const body = Array.from({ length: BODY_ROWS }, (_, i) => `row ${i}`).join("\n");

const http = (response: Partial<NonNullable<CheckResult["response"]>> = {}): CheckResult => ({
  name: "api",
  type: "http",
  ok: true,
  target: "http://127.0.0.1:4101/health",
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
});

function setup(result: CheckResult) {
  const tracker = new Tracker(["local"]);
  tracker.record("local", [result], 1);
  const view = initialView();
  const copied: [string, boolean][] = [];
  const actions: ViewActions = {
    quit() {},
    refresh() {},
    copyResponse: (text, cut) => copied.push([text, cut]),
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
  return { view, draw, press, copied };
}

describe("the response view", () => {
  it("shows the status line, every header and the start of the body", () => {
    const { press, draw } = setup(http());
    press("enter", "r");
    const text = draw();

    expect(text).toContain("HTTP/1.1 200 OK");
    expect(text).toContain("content-type: text/plain");
    expect(text).toContain("set-cookie: (hidden)");
    expect(text).toContain(`x-seen: key ${echo}`);
    expect(text).toContain("row 0");
    expect(text).toContain("response 1-");
  });

  it("scrolls to the end of a body longer than the detail shows", () => {
    const { press, draw } = setup(http());
    press("enter", "r");
    expect(draw()).not.toContain(`row ${BODY_ROWS - 1}`);

    press("end");
    const end = draw();
    expect(end).toContain(`row ${BODY_ROWS - 1}`);
    expect(end).not.toContain("row 0\n");

    press("home", "down");
    expect(draw()).not.toContain("HTTP/1.1 200 OK");
    press("pagedown");
    expect(draw()).toContain("response ");
  });

  it("cuts nothing of a long line: it folds", () => {
    const tail = "Z";
    const { press, draw } = setup(http({ body: `${"x".repeat(300)}${tail}` }));
    press("enter", "r");

    expect(draw()).toContain(`x${tail}`);
  });

  it("says when the body is cut", () => {
    const { press, draw } = setup(http({ bodyCut: true }));
    press("enter", "r", "end");

    expect(draw()).toContain("body cut");
  });

  it("goes back to the detail with r and closes with escape", () => {
    const { press, draw, view } = setup(http());
    press("enter", "r", "r");
    expect(draw()).toContain("GET http://127.0.0.1:4101/health");

    press("r", "escape");
    expect(view.modals.depth).toBe(0);
  });

  it("says the view is HTTP-only for another type", () => {
    const { press, view } = setup({
      name: "db",
      type: "tcp",
      ok: true,
      target: "x:1",
      latencyMs: 1,
    });
    press("enter", "r");

    expect(view.status?.text).toBe(HTTP_ONLY);
  });

  it("says so when no response came back", () => {
    const { press, view } = setup({ ...http(), status: undefined, response: undefined, ok: false });
    press("enter", "r");

    expect(view.status?.text).toContain("No response");
  });
});

describe("copying the response", () => {
  it("copies the status line, the headers, a blank line and the body, as curl -i does", () => {
    const { press, copied } = setup(http({ body: "hello" }));
    press("enter", "r", "c");

    expect(copied).toEqual([
      [
        `HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\nset-cookie: (hidden)\r\nx-seen: key ${echo}\r\n\r\nhello`,
        false,
      ],
    ]);
  });

  it("copies the whole body, not what the screen shows", () => {
    const { press, copied } = setup(http());
    press("enter", "r", "c");

    expect(copied[0]?.[0].endsWith(`row ${BODY_ROWS - 1}`)).toBe(true);
  });

  it("tells when the body copied is cut", () => {
    const { press, copied } = setup(http({ bodyCut: true }));
    press("enter", "r", "c");

    expect(copied[0]?.[1]).toBe(true);
  });

  it("ends after the blank line when there is no body", () => {
    expect(responseText(http({ body: undefined }))?.endsWith("\r\n\r\n")).toBe(true);
  });

  it("keeps the curl command on c in the detail", () => {
    const { press, copied } = setup(http());
    press("enter", "c");

    expect(copied).toEqual([]);
  });
});
