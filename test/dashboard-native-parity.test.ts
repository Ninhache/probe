import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { Config } from "../src/config/schema";
import { helpBarItems, helpColumns } from "../src/dashboard/keymap";
import { Tracker } from "../src/dashboard/native/history";
import {
  environmentChecks,
  mergedParameters,
  mismatchNotice,
  shouldNotify,
} from "../src/dashboard/native/open";
import {
  handleInput,
  initialView,
  renderDashboard,
  say,
  type ViewActions,
  type ViewInit,
} from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import { fieldKey, fieldValue, textField } from "../src/tui/textfield";

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

describe("detail bindings", () => {
  it("advertises skip and timeout on the detail bar and in the help", () => {
    const bar = helpBarItems("detail", true, 200);
    expect(bar.map(({ action }) => action)).toEqual(expect.arrayContaining(["timeout", "skip"]));
    const inHelp = helpColumns(true, 200)
      .flat()
      .map((line) => JSON.stringify(line))
      .join("");
    expect(inHelp).toContain("Skip the service");
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
    press("right");
    expect(view.selection).toEqual({ region: "us", env: "prod" });
    press("down", "left");
    expect(calls).toEqual(["parameter env=prod", "parameter region=eu"]);
    press("escape");
    expect(draw().split("\n")[0]).toContain("env: prod");
  });

  it("offers no value after the last one, and shows it in the header", () => {
    const { press, calls, view, draw } = setup({ choices });
    press("p", "right", "right", "right");
    expect(view.selection).toEqual({ env: "" });
    expect(calls).toEqual(["parameter env=prod", "parameter env="]);
    expect(draw()).toContain("(none)");
    press("escape");
    expect(draw().split("\n")[0]).toContain("env: (none)");
  });

  it("says so when the config declares none", () => {
    const { press, draw } = setup();
    press("p");
    expect(draw().split("\n").at(-1)).toContain(".probe/config.yml declares no parameter");
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

describe("values of local.yml", () => {
  it("are checked in every tab, while edits keep the declared services", async () => {
    const server = createServer((_, res) => res.end("hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const declared: Config = {
        schemaVersion: 1,
        services: { api: { host: "127.0.0.1", port: 1, path: "/" } },
      };
      const overrides = { at: "services", services: { api: { port } } };
      const source = {
        name: "staging",
        file: "staging.yml",
        load: async () => ({
          config: declared,
          variables: {},
          skipped: new Set<string>(),
          overrides: { at: "envs.staging.services", services: { api: { port } } },
        }),
      };
      const live = {
        settings: { intervalMs: 1000, timeoutMs: 3000 },
        selection: {},
        skipped: new Set<string>(),
        timeouts: {},
      };
      const seen: Config[] = [];
      const checks = environmentChecks(
        {
          config: declared,
          environments: [source],
          settings: live.settings,
          overrides: async () => overrides,
        } as never,
        () => live,
        (_, config) => seen.push(config),
      );
      const signal = new AbortController().signal;
      for (const check of checks) {
        const [api] = await check.run(signal);
        expect(api?.ok).toBe(true);
      }
      expect(seen).toEqual([declared]);
      expect(declared.services.api?.port).toBe(1);
    } finally {
      server.close();
    }
  });
});

describe("services local.yml adds", () => {
  it("are checked in every tab and told apart from the declared ones", async () => {
    const server = createServer((_, res) => res.end("hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const declared: Config = { schemaVersion: 1, services: {} };
      const scratch = { host: "127.0.0.1", port, path: "/" };
      const source = {
        name: "staging",
        file: "staging.yml",
        load: async () => ({
          config: declared,
          variables: {},
          skipped: new Set<string>(),
          overrides: { at: "envs.staging.services", services: {}, extra: { scratch } },
        }),
      };
      const live = {
        settings: { intervalMs: 1000, timeoutMs: 3000 },
        selection: {},
        skipped: new Set<string>(),
        timeouts: {},
      };
      const added: [string, string[]][] = [];
      const checks = environmentChecks(
        {
          config: declared,
          environments: [source],
          settings: live.settings,
          overrides: async () => ({ at: "services", services: {}, extra: { scratch } }),
          // The dashboard of a project can add services: its local tab is there, empty or not.
          onServiceWrite: async () => ({}),
        } as never,
        () => live,
        () => {},
        (env, names) => added.push([env, [...names]]),
      );
      const signal = new AbortController().signal;
      for (const check of checks) {
        const [result] = await check.run(signal);
        expect(result).toMatchObject({ name: "scratch", ok: true });
      }
      expect(added).toEqual([
        ["local", ["scratch"]],
        ["staging", ["scratch"]],
      ]);
      expect(declared.services).toEqual({});
    } finally {
      server.close();
    }
  });
});

describe("the notice of local.yml out of step", () => {
  const config: Config = {
    schemaVersion: 1,
    services: { api: { host: "localhost", port: 1, path: "/" } },
  };

  it("says the first mismatch, and how many others doctor lists", async () => {
    const notice = await mismatchNotice({
      config,
      overrides: async () => ({
        at: "services",
        services: { gone: { port: 2 }, old: { timeout: 1 } },
        extra: { api: { port: 3 } },
      }),
    });

    expect(notice).toBe(
      "local.yml: services.gone is no longer in config.yml: its values are unused. Remove them from .probe/local.yml. (2 more: probe doctor)",
    );
  });

  it("says nothing when local.yml is in step", async () => {
    const notice = await mismatchNotice({
      config,
      overrides: async () => ({ at: "services", services: { api: { port: 2 } } }),
    });

    expect(notice).toBeUndefined();
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

describe("notifications", () => {
  it("stay quiet while the terminal has the focus", () => {
    expect(shouldNotify(true, 1, false)).toBe(true);
    expect(shouldNotify(true, 1, undefined)).toBe(true);
    expect(shouldNotify(true, 1, true)).toBe(false);
    expect(shouldNotify(false, 1, false)).toBe(false);
    expect(shouldNotify(true, 0, false)).toBe(false);
  });
});

describe("merged parameters", () => {
  it("joins the local values and those of the environments, without repeats", () => {
    const declare = (parameters: Record<string, string[]>): Config => ({
      schemaVersion: 1,
      services: {},
      parameters: Object.fromEntries(
        Object.entries(parameters).map(([name, values]) => [
          name,
          { values, strategy: { kind: "path" as const } },
        ]),
      ),
    });
    expect(
      mergedParameters(declare({ zone: ["eu"] }), [
        declare({ zone: ["eu", "us"], size: ["s"] }),
        declare({}),
      ]),
    ).toEqual({ zone: ["eu", "us"], size: ["s"] });
  });
});

describe("terminal focus reports", () => {
  it("are one key nobody acts on", () => {
    for (const report of ["\x1b[I", "\x1b[O"]) {
      const events = parseInput(report);
      expect(events).toHaveLength(1);
      const [event] = events as [InputEvent];
      expect(event.kind === "key" && event.name).toBe("unknown");
      const field = textField("abc");
      expect(event.kind === "key" && fieldKey(field, event)).toBe(field);
      expect(fieldValue(field)).toBe("abc");
      const { view } = setup();
      const before = { ...view, modals: undefined };
      handleInput(event, new Tracker(["local"]), view, { quit() {}, refresh() {} });
      expect({ ...view, modals: undefined }).toEqual(before);
    }
  });
});
