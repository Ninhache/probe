import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { reference } from "../src/config/headers";
import { JSON_FORMAT_MAX_BYTES } from "../src/constants";
import { type ActionDeps, serviceActions } from "../src/dashboard/actions";
import { formattedBody, jsonLines } from "../src/dashboard/json-body";
import { Tracker } from "../src/dashboard/native/history";
import { responseRows } from "../src/dashboard/native/panels";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

type Response = NonNullable<CheckResult["response"]>;

const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;

const response = (body: string, type: string | undefined, extra: Partial<Response> = {}) =>
  ({
    statusText: "OK",
    headers: type ? [["Content-Type", type]] : [],
    body,
    ...extra,
  }) satisfies Response;

const RAW = '{"name":"acme","tags":["a","b"],"n":12,"ok":true,"none":null,"empty":{},"list":[]}';

const result = (r: Response): CheckResult => ({
  name: "api",
  type: "http",
  ok: true,
  target: "http://127.0.0.1:4101/health",
  latencyMs: 12,
  status: 200,
  method: "GET",
  response: r,
});

function setup(r: Response, mode: "truecolor" | "none" = "truecolor") {
  const tracker = new Tracker(["local"]);
  tracker.record("local", [result(r)], 1);
  const view = initialView();
  const copied: [string, boolean, string | undefined, boolean | undefined][] = [];
  const actions: ViewActions = {
    quit() {},
    refresh() {},
    copyResponse: (text, cut, part, formatted) => copied.push([text, cut, part, formatted]),
  };
  const screen = new Screen(110, 40, mode);
  const draw = () => {
    renderDashboard(screen, { x: 0, y: 0, w: 110, h: 40 }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (...names: string[]) => {
    for (const name of names) handleInput(key(name), tracker, view, actions);
  };
  draw();
  return { press, draw, copied, screen };
}

const SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, "g");
const fgOf = (out: string) => new Set([...out.matchAll(SGR)].map((m) => m[1]));
const rgb = ([r, g, b]: number[]) => `0;38;2;${r};${g};${b}`;

describe("detecting a JSON body", () => {
  it.each([
    ["application/json", RAW],
    ["application/json; charset=utf-8", RAW],
    ["application/problem+json", RAW],
    ["application/json", "42"],
  ])("should format on the content-type %s", (type, body) => {
    expect(jsonLines(response(body, type))).toBeDefined();
  });

  it.each([
    ["text/plain", RAW],
    [undefined, ` \n[1, 2]`],
  ])("should format by sniffing a body of type %s that parses", (type, body) => {
    expect(jsonLines(response(body, type))).toBeDefined();
  });

  it.each([
    ["text/plain", "42"],
    ["text/plain", "not json"],
    ["text/html", "<p>{}</p>"],
    ["text/plain", "{not json"],
    ["application/json", "{not json"],
  ])("should leave %s with %j as it is", (type, body) => {
    expect(jsonLines(response(body, type))).toBeUndefined();
  });

  it("should not format a body cut at the cap", () => {
    expect(jsonLines(response(RAW, "application/json", { bodyCut: true }))).toBeUndefined();
  });

  it("should lay out with two spaces of indent", () => {
    expect(formattedBody(response('{"a":[1,{"b":null}],"c":{},"d":[]}', undefined))).toBe(
      [
        "{",
        '  "a": [',
        "    1,",
        "    {",
        '      "b": null',
        "    }",
        "  ],",
        '  "c": {},',
        '  "d": []',
        "}",
      ].join("\n"),
    );
  });

  it("should keep a masked secret, and not decode an escaped one", () => {
    const masked = `{"token":"Bearer ${reference("API_KEY")}","raw":"\\u0073ecret","big":12345678901234567890}`;

    const text = formattedBody(response(masked, "application/json"));

    expect(text).toContain(`"Bearer ${reference("API_KEY")}"`);
    expect(text).toContain('"\\u0073ecret"');
    expect(text).not.toContain("secret");
    expect(text).toContain("12345678901234567890");
  });
});

describe("the response tab with a JSON body", () => {
  it("should show it indented and in colour", () => {
    const { press, draw, screen } = setup(response(RAW, "application/json"));
    press("2");

    const text = draw();
    const out = screen.flush();

    expect(text).toContain('  "name": "acme"');
    expect(text).toContain('    "a"'.replace('"a"', '"a",'));
    const colours = fgOf(out);
    for (const c of [
      [240, 171, 252],
      [74, 222, 128],
      [250, 204, 21],
      [96, 165, 250],
      [248, 113, 113],
      [113, 113, 122],
    ])
      expect(colours).toContain(rgb(c));
  });

  it("should draw no colour under NO_COLOR", () => {
    const { press, draw, screen } = setup(response(RAW, "application/json"), "none");
    press("2");

    expect(draw()).toContain('  "name": "acme"');
    for (const param of [...screen.flush().matchAll(SGR)].flatMap((m) => (m[1] ?? "").split(";")))
      expect(["0", "1", "2", "3", "4", "7", ""]).toContain(param);
  });

  it("should draw only ASCII in ascii mode", () => {
    const { press, draw, screen } = setup(response(RAW, "application/json"));
    screen.ascii = true;
    press("2");

    expect(draw()).toContain('  "name": "acme"');
    expect(screen.toPlainText()).not.toMatch(/[^\x20-\x7e\n]/);
  });

  it("should show an invalid body as it is", () => {
    const { press, draw } = setup(response('{"a":1,', "application/json"));
    press("2");

    expect(draw()).toContain('{"a":1,');
  });

  it("should show a cut body as it is", () => {
    const { press, draw } = setup(response('{"a":1,"b":2}', "application/json", { bodyCut: true }));
    press("2");

    expect(draw()).toContain('{"a":1,"b":2}');
  });

  it("should format in the full response view too, and fold a long line", () => {
    const long = "x".repeat(300);
    const { press, draw } = setup(response(`{"k":"${long}Z"}`, "application/json"));
    press("enter", "r");

    const text = draw();

    expect(text).toContain('  "k": "xxx');
    expect(text).toContain("xZ");
  });
});

describe("copying a JSON body", () => {
  it("should copy the formatted body with b, masked", () => {
    const body = `{"k":"${reference("API_KEY")}"}`;
    const { press, copied } = setup(response(body, "application/json"));

    press("b");

    expect(copied).toEqual([[`{\n  "k": "${reference("API_KEY")}"\n}`, false, "body", true]]);
  });

  it("should copy a plain body unchanged", () => {
    const { press, copied } = setup(response("hello", "text/plain"));

    press("b");

    expect(copied).toEqual([["hello", false, "body", false]]);
  });

  it("should say the body was formatted", async () => {
    const deps: ActionDeps = {
      platform: "linux",
      env: {},
      openUrl: async () => true,
      copyText: async () => true,
      notify: async () => true,
    };
    const actions = serviceActions((c) => c as never, deps);

    expect(await actions.onCopyResponse("{}", false, "body", true)).toBe(
      "Copied the body (formatted JSON)",
    );
    expect(await actions.onCopyResponse("x", false, "body")).toBe("Copied the body");
  });
});

const bigJson = (bytes: number) => {
  const item = '{"id":12345,"name":"some name","tags":["a","b"],"ok":true,"none":null}';
  return `[${Array.from({ length: Math.ceil(bytes / (item.length + 1)) }, () => item).join(",")}]`;
};

describe("the cost of a JSON body", () => {
  it("should format a body at the cap in a short time", () => {
    const r = response(bigJson(JSON_FORMAT_MAX_BYTES - 100), "application/json");
    const start = performance.now();

    const lines = jsonLines(r);
    const ms = performance.now() - start;

    expect(lines?.length).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(1000);
  });

  it("should not format a body over the cap, and say so", () => {
    const r = response(bigJson(JSON_FORMAT_MAX_BYTES + 1000), "application/json");

    const rows = responseRows(result(r), 100);

    expect(jsonLines(r)).toBeUndefined();
    expect(formattedBody(r)).toBeUndefined();
    expect(rows.some((row) => row.text.startsWith("JSON not formatted: body over 256 KiB"))).toBe(
      true,
    );
    expect(rows.at(-1)?.spans).toBeUndefined();
  });

  it("should format and fold once per result and width, however many draws", () => {
    const r = response(bigJson(JSON_FORMAT_MAX_BYTES - 100), "application/json");
    const one = result(r);

    const first = responseRows(one, 100);

    expect(jsonLines(r)).toBe(jsonLines(r));
    expect(responseRows(one, 100)).toBe(first);
    expect(responseRows(one, 80)).not.toBe(first);
    expect(responseRows(one, 80)).toBe(responseRows(one, 80));
  });

  it("should redraw the response tab at a cost that does not depend on the body size", () => {
    const warm = (bytes: number) => {
      const { press, draw } = setup(response(bigJson(bytes), "application/json"));
      press("2");
      draw();
      return () => {
        const start = performance.now();
        for (let i = 0; i < 100; i++) draw();
        return performance.now() - start;
      };
    };
    const small = warm(2 * 1024);
    const big = warm(JSON_FORMAT_MAX_BYTES - 100);

    // The fastest of a few rounds, interleaved: a load spike hits both sizes, not one of them.
    let smallMs = Number.POSITIVE_INFINITY;
    let bigMs = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 5; round++) {
      smallMs = Math.min(smallMs, small());
      bigMs = Math.min(bigMs, big());
    }

    expect(bigMs / smallMs).toBeLessThan(3);
    // A very loose safety net, far above any machine's load.
    expect(bigMs).toBeLessThan(10_000);
    console.info(
      `100 warm redraws: ${smallMs.toFixed(1)} ms for 2 KiB, ${bigMs.toFixed(1)} ms for ${JSON_FORMAT_MAX_BYTES / 1024} KiB`,
    );
  });
});
