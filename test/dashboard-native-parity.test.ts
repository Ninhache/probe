import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { Config } from "../src/config/schema";
import { helpBarItems, helpColumns } from "../src/dashboard/keymap";
import { Tracker } from "../src/dashboard/native/history";
import { environmentChecks } from "../src/dashboard/native/open";
import {
  handleInput,
  initialView,
  renderDashboard,
  say,
  type ViewActions,
  type ViewInit,
} from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const key = (name: string, extra: Partial<InputEvent> = {}): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name, ...extra }) as InputEvent;

const answered: CheckResult = {
  name: "api",
  type: "http",
  ok: true,
  target: "http://127.0.0.1:4101/health",
  latencyMs: 12,
  status: 200,
  method: "GET",
  sent: ["Authorization: Bearer ***", "Accept: */*"],
  response: {
    statusText: "OK",
    headers: [
      ["content-type", "application/json"],
      ["date", "now"],
    ],
    body: '{"ok":true}',
  },
} as CheckResult;

function setup(init: ViewInit = {}) {
  const tracker = new Tracker(["local"]);
  tracker.record("local", [answered, { ...answered, name: "web", status: 204 } as CheckResult], 1);
  const view = initialView(init);
  const calls: string[] = [];
  const actions: ViewActions = {
    quit: () => calls.push("quit"),
    refresh: () => calls.push("refresh"),
    open: (s, e) => calls.push(`open ${s}@${e}`),
    copy: (s, e) => calls.push(`copy ${s}@${e}`),
    skip: (s, k) => calls.push(`skip ${s} ${k}`),
    timeout: (s, n) => calls.push(`timeout ${s} ${n}`),
    settings: (n) => calls.push(`settings ${n.intervalMs} ${n.timeoutMs} ${n.notify}`),
    parameter: (n, v) => calls.push(`parameter ${n}=${v}`),
  };
  const draw = (w = 110, h = 32) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (...names: string[]) => {
    for (const name of names) handleInput(key(name), tracker, view, actions);
  };
  draw();
  return { tracker, view, calls, draw, press };
}

describe("help bar keys", () => {
  it("gives the keys apart from the actions, dropping by rank", () => {
    const wide = helpBarItems("list", true, 200);
    expect(wide[0]).toEqual({ keys: "↑↓ jk", action: "move" });
    const narrow = helpBarItems("list", true, 40);
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow.at(-1)).toEqual({ keys: "q", action: "quit" });
  });
});

describe("native-only bindings", () => {
  it("advertises skip and timeout on the native detail bar and help, not on ink's", () => {
    const native = helpBarItems("detail", true, 200, false, false, true);
    expect(native.map(({ action }) => action)).toEqual(expect.arrayContaining(["timeout", "skip"]));
    expect(helpBarItems("detail", true, 200).map(({ action }) => action)).not.toContain("skip");
    const inHelp = (native: boolean) =>
      helpColumns(true, 200, false, native)
        .flat()
        .map((line) => JSON.stringify(line))
        .join("");
    expect(inHelp(true)).toContain("Skip the service");
    expect(inHelp(false)).not.toContain("Skip the service");
  });
});

describe("service detail", () => {
  it("shows the request, status, headers and body for the selected service", () => {
    const { press, draw, view } = setup();
    press("enter");
    const text = draw();
    expect(text).toContain("┤api@local├");
    expect(text).toContain("200 OK · 12ms");
    expect(text).toContain("GET http://127.0.0.1:4101/health");
    expect(text).toContain("Headers sent:");
    expect(text).toContain("content-type: application/json");
    expect(text).toContain('{"ok":true}');
    press("escape");
    expect(view.modals.depth).toBe(0);
  });

  it("says so when nothing came back yet", () => {
    const view = initialView();
    const empty = new Tracker(["local"]);
    handleInput(key("enter"), empty, view, { quit() {}, refresh() {} });
    expect(view.modals.depth).toBe(0);
  });
});

describe("actions", () => {
  it("opens and copies for the selected service, in the detail too", () => {
    const { press, calls } = setup();
    press("u", "c", "j", "u", "enter", "c", "u");
    expect(calls).toEqual([
      "open api@local",
      "copy api@local",
      "open web@local",
      "copy web@local",
      "open web@local",
    ]);
  });

  it("toggles skip and steps the timeout from the detail, saving each", () => {
    const { press, calls, view, draw } = setup({ timeouts: { api: 3 } });
    press("enter", "s");
    expect(view.skipped.has("api")).toBe(true);
    expect(draw()).toContain("yes");
    press("right", "left", "left");
    expect(view.timeouts.api).toBe(2);
    press("s");
    expect(calls).toEqual([
      "skip api true",
      "timeout api 5",
      "timeout api 3",
      "timeout api 2",
      "skip api false",
    ]);
    press("escape");
    expect(draw()).not.toContain("┤api@local├");
  });

  it("shows a skipped service as skipped in the table", () => {
    const { press, draw } = setup();
    press("enter", "s", "escape");
    expect(draw()).toContain("- skipped");
  });

  it("does not write for another environment", () => {
    const tracker = new Tracker(["local", "prod"]);
    tracker.record("prod", [answered], 1);
    const view = initialView();
    const calls: string[] = [];
    const actions = { quit() {}, refresh() {}, skip: () => calls.push("skip") };
    renderDashboard(new Screen(110, 32, "truecolor"), { x: 0, y: 0, w: 110, h: 32 }, tracker, view);
    handleInput(key("enter"), tracker, view, actions);
    handleInput(key("s"), tracker, view, actions);
    expect(calls).toEqual([]);
    expect(view.modals.depth).toBe(1);
  });

  it("tells a placeholder key is not in this screen yet", () => {
    const { press, draw } = setup();
    for (const name of ["a", "e", "d", "z", ":"]) {
      press(name);
      expect(draw().split("\n").at(-1)).toContain("not yet in this screen");
    }
  });

  it("replaces the bar with an outcome, then gives it back", () => {
    const { view, tracker, draw } = setup();
    say(view, "Copied: curl x\nnote", 0);
    expect(draw().split("\n").at(-1)).toContain("Copied: curl x · note");
    const screen = new Screen(110, 32, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w: 110, h: 32 }, tracker, view, 60_000);
    expect(screen.toPlainText().split("\n").at(-1)).toContain("↑↓ jk move");
  });
});

describe("options", () => {
  it("steps interval and timeout and toggles notifications, saving each", () => {
    const { press, calls, view, draw } = setup({
      settings: { intervalMs: 2000, timeoutMs: 3000 },
    });
    press("o");
    expect(draw()).toContain("┤options├");
    press("right", "down", "right", "down", "right");
    expect(view.settings).toEqual({ intervalMs: 5000, timeoutMs: 5000, notify: true });
    expect(calls).toEqual([
      "settings 5000 3000 undefined",
      "settings 5000 5000 undefined",
      "settings 5000 5000 true",
    ]);
    expect(draw()).toContain("on");
    press("escape");
    expect(view.modals.depth).toBe(0);
  });
});

describe("parameters", () => {
  const choices = { env: ["dev", "prod"], region: ["eu", "us"] };

  it("shows the selectors and changes a value with the arrows", () => {
    const { press, calls, view, draw } = setup({ choices, selection: { region: "us" } });
    expect(draw().split("\n")[0]).toContain("env: dev");
    expect(draw().split("\n")[0]).toContain("region: us");
    press("p");
    expect(draw()).toContain("┤parameters├");
    press("down", "down");
    expect(view.selection).toEqual({ region: "us", env: "prod" });
    press("right", "up");
    expect(calls).toEqual(["parameter env=prod", "parameter region=eu"]);
    press("escape");
    expect(draw().split("\n")[0]).toContain("env: prod");
  });

  it("says so when the config declares none", () => {
    const { press, draw } = setup();
    press("p");
    expect(draw().split("\n").at(-1)).toContain("no parameters");
  });

  it("offers the parameter binding in the bar only with parameters", () => {
    expect(setup().draw().split("\n").at(-1)).not.toContain("p parameters");
    expect(setup({ choices }).draw().split("\n").at(-1)).toContain("p parameters");
  });
});

describe("checks follow the screen", () => {
  it("runs with the live selection, timeouts and skips, and keeps the response", async () => {
    const server = createServer((_, res) => res.end("hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const config = {
        schemaVersion: 1,
        services: {
          api: { host: "127.0.0.1", port, path: "/" },
          web: { host: "127.0.0.1", port, path: "/" },
        },
      };
      const live = {
        settings: { intervalMs: 1000, timeoutMs: 3000 },
        selection: {},
        skipped: new Set(["web"]),
        timeouts: { api: 2 },
      };
      const [local] = environmentChecks(
        { config, environments: [], settings: live.settings } as never,
        () => live,
      );
      const results = await (local as NonNullable<typeof local>).run(new AbortController().signal);
      const api = results.find((r) => r.name === "api");
      expect(api?.ok).toBe(true);
      expect(api?.response?.body).toBe("hello");
      expect(results.find((r) => r.name === "web")?.skipped).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("environment parameters", () => {
  it("reports what each environment's file declares on every pass", async () => {
    let declared: Config = {
      schemaVersion: 1,
      services: {},
      parameters: { zone: { values: ["eu"], strategy: { kind: "path" } } },
    };
    const source = {
      name: "staging",
      file: "staging.yml",
      load: async () => ({ config: declared, variables: {}, skipped: new Set<string>() }),
    };
    const seen: string[] = [];
    const live = {
      settings: { intervalMs: 1000, timeoutMs: 3000 },
      selection: {},
      skipped: new Set<string>(),
      timeouts: {},
    };
    const [check] = environmentChecks(
      {
        config: { schemaVersion: 1, services: {} },
        environments: [source],
        settings: live.settings,
      } as never,
      () => live,
      (env, config) => seen.push(`${env}:${Object.keys(config.parameters ?? {})}`),
    );
    await (check as NonNullable<typeof check>).run(new AbortController().signal);
    declared = {
      ...declared,
      parameters: {
        zone: { values: ["eu"], strategy: { kind: "path" } },
        size: { values: ["s"], strategy: { kind: "path" } },
      },
    };
    await (check as NonNullable<typeof check>).run(new AbortController().signal);
    expect(seen).toEqual(["staging:zone", "staging:zone,size"]);
  });
});
