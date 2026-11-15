import { EventEmitter } from "node:events";
import { render as inkRender } from "ink";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { Dashboard, type DashboardProps, type ServiceTimeouts } from "../src/dashboard/Dashboard";
import type { DashboardSettings } from "../src/dashboard/settings";
import type { Terminal } from "../src/ui/terminal";

const plain: Terminal = {
  isTTY: true,
  color: false,
  columns: 100,
  hyperlinks: false,
  unicode: true,
};

const api: CheckResult = {
  name: "api",
  type: "http",
  ok: true,
  target: "http://localhost:3000/health",
  status: 200,
  latencyMs: 4,
};
const db: CheckResult = {
  name: "db",
  type: "http",
  ok: false,
  target: "http://localhost:5432/",
  latencyMs: 1,
  error: "connection refused",
};

const ESCAPE = String.fromCharCode(27);
const ENTER = "\r";
const BACKSPACE = String.fromCharCode(127);
const TAB = "\t";
const SAVED = { saved: true };
const checkUnlessSkipped: DashboardProps["check"] = async (_signal, _timeoutMs, skipped) =>
  [api, db].map((result) =>
    skipped.has(result.name)
      ? {
          name: result.name,
          type: result.type,
          target: result.target,
          ok: true,
          skipped: true,
          latencyMs: 0,
        }
      : result,
  );
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

// A long value is some fifty keys, one per render: over a second on a slow CI runner.
const waitFor = <T,>(check: () => T) => vi.waitFor(check, { timeout: 10_000 });
const shows = (lastFrame: () => string | undefined, text: string) =>
  waitFor(() => expect(lastFrame()).toContain(text));
const hides = (lastFrame: () => string | undefined, text: string) =>
  waitFor(() => expect(lastFrame()).not.toContain(text));

let app: ReturnType<typeof render> | undefined;
afterEach(() => app?.unmount());

function open(options: {
  terminal?: Terminal;
  intervalMs?: number;
  skipped?: string[];
  timeouts?: ServiceTimeouts;
  check?: DashboardProps["check"];
  onTimeoutChange?: DashboardProps["onTimeoutChange"];
  onSettingsChange?: DashboardProps["onSettingsChange"];
  onSkipChange?: DashboardProps["onSkipChange"];
  onOpen?: DashboardProps["onOpen"];
  onCopy?: DashboardProps["onCopy"];
  notify?: boolean;
  onNotify?: DashboardProps["onNotify"];
  serviceFields?: DashboardProps["serviceFields"];
  onServiceWrite?: DashboardProps["onServiceWrite"];
  variables?: DashboardProps["variables"];
  onVariableWrite?: DashboardProps["onVariableWrite"];
}) {
  app = render(
    <Dashboard
      terminal={options.terminal ?? plain}
      settings={{
        intervalMs: options.intervalMs ?? 60_000,
        timeoutMs: 3_000,
        ...(options.notify ? { notify: true } : {}),
      }}
      check={options.check ?? (async () => [api, db])}
      skipped={options.skipped}
      timeouts={options.timeouts}
      onTimeoutChange={options.onTimeoutChange}
      onSettingsChange={options.onSettingsChange}
      onSkipChange={options.onSkipChange}
      onOpen={options.onOpen}
      onCopy={options.onCopy}
      onNotify={options.onNotify}
      serviceFields={options.serviceFields}
      onServiceWrite={options.onServiceWrite}
      variables={options.variables}
      onVariableWrite={options.onVariableWrite}
    />,
  );
  return app;
}

describe("dashboard", () => {
  it("lists the services with a summary and the keys", async () => {
    const { lastFrame } = open({});
    await tick();
    expect(lastFrame()).toBe(
      [
        "probe · 1/2 up · every 60s",
        "› ✓ api  http://localhost:3000/health  200  4ms",
        "  ✗ db   http://localhost:5432/        connection refused",
        "http://localhost:3000/health",
        "↑↓ jk move · ↵ service · a add · / filter · : commands · ? help · q quit",
      ].join("\n"),
    );
  });

  it("writes no escape sequence when the terminal shows no colour", async () => {
    const { frames } = open({});
    await tick();
    expect(frames.join("")).not.toContain(ESCAPE);
  });

  it("colours the rows when the terminal shows colours", async () => {
    const { lastFrame } = open({ terminal: { ...plain, color: true } });
    await tick();
    expect(lastFrame()).toContain(`${ESCAPE}[32m✓`);
  });

  it("falls back to ASCII markers without unicode", async () => {
    const { lastFrame } = open({ terminal: { ...plain, unicode: false } });
    await tick();
    expect(lastFrame()).toContain("> ✓ api");
    expect(lastFrame()).toContain(
      "jk move - enter service - a add - / filter - : commands - ? help - q quit",
    );
  });

  it("moves the selection with j, k and the arrows, within the list", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("j");
    await tick();
    expect(lastFrame()).toContain("› ✗ db");
    expect(lastFrame()).toContain("http://localhost:5432/ · connection refused");
    stdin.write("j");
    await tick();
    expect(lastFrame()).toContain("› ✗ db");
    stdin.write(`${ESCAPE}[A`);
    await tick();
    expect(lastFrame()).toContain("› ✓ api");
    stdin.write("k");
    await tick();
    expect(lastFrame()).toContain("› ✓ api");
    stdin.write(`${ESCAPE}[B`);
    await tick();
    expect(lastFrame()).toContain("› ✗ db");
  });

  it("checks again by itself after the interval", async () => {
    let passes = 0;
    const check = async () => {
      passes += 1;
      return [api];
    };
    open({ intervalMs: 40, check });
    await tick(200);
    expect(passes).toBeGreaterThan(2);
  });

  it("checks again at once on r", async () => {
    let passes = 0;
    const check = async () => {
      passes += 1;
      return [{ ...api, latencyMs: passes }];
    };
    const { lastFrame, stdin } = open({ check });
    await tick();
    expect(passes).toBe(1);
    stdin.write("r");
    await tick();
    expect(passes).toBe(2);
    expect(lastFrame()).toContain("200  2ms");
  });

  it("aborts the running checks and stops polling when it closes", async () => {
    let signal: AbortSignal | undefined;
    let passes = 0;
    const check = (given: AbortSignal) => {
      signal = given;
      passes += 1;
      return new Promise<CheckResult[]>((resolve) => {
        given.addEventListener("abort", () => resolve([api]));
      });
    };
    const { stdin } = open({ intervalMs: 10, check });
    await tick();
    expect(signal?.aborted).toBe(false);
    stdin.write("q");
    await tick(80);
    expect(signal?.aborted).toBe(true);
    expect(passes).toBe(1);
  });

  it("opens the options on o and closes them on escape", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("o");
    await tick();
    expect(lastFrame()).toBe(
      [
        "probe · 1/2 up · every 60s",
        "› ✓ api  http://localhost:3000/health  200  4ms",
        "  ✗ db   http://localhost:5432/        connection refused",
        "http://localhost:3000/health",
        "┌────────────────────────────┐",
        "│ Options                    │",
        "│ › Interval  ‹ 60s ›        │",
        "│   Timeout   ‹ 3s ›         │",
        "│   Notify    ‹ off ›        │",
        "└────────────────────────────┘",
        "↑↓ jk move · ←→ hl change · esc close · ? help · q quit",
      ].join("\n"),
    );
    stdin.write(ESCAPE);
    await tick(150);
    expect(lastFrame()).not.toContain("Options");
    expect(lastFrame()).toContain("/ filter");
  });

  it("changes the interval from the options, within the choices", async () => {
    const changes: DashboardSettings[] = [];
    const { lastFrame, stdin } = open({
      onSettingsChange: (next) => {
        changes.push(next);
      },
    });
    await tick();
    stdin.write("o");
    await tick();
    stdin.write("h");
    await tick();
    expect(lastFrame()).toContain("every 30s");
    expect(lastFrame()).toContain("› Interval  ‹ 30s ›");
    stdin.write(`${ESCAPE}[C`);
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("every 60s");
    expect(changes).toEqual([
      { intervalMs: 30_000, timeoutMs: 3_000 },
      { intervalMs: 60_000, timeoutMs: 3_000 },
    ]);
  });

  it("checks again with the new timeout as soon as it changes", async () => {
    const timeouts: number[] = [];
    const check = async (_signal: AbortSignal, timeoutMs: number) => {
      timeouts.push(timeoutMs);
      return [api];
    };
    const { lastFrame, stdin } = open({ check });
    await tick();
    stdin.write("o");
    await tick();
    stdin.write("j");
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("› Timeout   ‹ 5s ›");
    expect(timeouts).toEqual([3_000, 5_000]);
  });

  it("keeps the list still while the options are open", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("o");
    await tick();
    stdin.write("j");
    await tick();
    expect(lastFrame()).toContain("› ✓ api");
    expect(lastFrame()).toContain("› Timeout");
  });

  it("draws the options in ASCII, with no escape sequence, without unicode or colour", async () => {
    const { lastFrame, frames, stdin } = open({ terminal: { ...plain, unicode: false } });
    await tick();
    stdin.write("o");
    await tick();
    expect(lastFrame()).toContain("| > Interval  < 60s >        |");
    expect(lastFrame()).toContain("jk move - hl change - esc close - ? help - q quit");
    expect(frames.join("")).not.toContain(ESCAPE);
  });

  it("opens the settings of the selected service on enter and closes them on enter", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("j");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toBe(
      [
        "probe · 1/2 up · every 60s",
        "  ✓ api  http://localhost:3000/health  200  4ms",
        "› ✗ db   http://localhost:5432/        connection refused",
        "http://localhost:5432/ · connection refused",
        "┌──────────────────────────────────────────────────────────┐",
        "│ db                                                       │",
        "│ connection refused                                       │",
        "│ ──────────────────────────────────────────────────────── │",
        "│ › Skip     ‹ no ›                                        │",
        "│   Timeout  ‹ default ›                                   │",
        "└──────────────────────────────────────────────────────────┘",
        "↑↓ jk move · ←→ hl change · esc close · ? help · q quit",
      ].join("\n"),
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).not.toContain("Skip");
  });

  it("stops checking a service set aside from its panel, and says so", async () => {
    const changes: [string, boolean][] = [];
    const { lastFrame, stdin } = open({
      check: checkUnlessSkipped,
      onSkipChange: (name, skip) => {
        changes.push([name, skip]);
      },
    });
    await tick();
    stdin.write("j");
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("probe · 1/1 up · 1 skipped · every 60s");
    expect(lastFrame()).toContain("› - db   http://localhost:5432/        skipped");
    expect(lastFrame()).toContain("› Skip     ‹ yes ›");
    stdin.write("h");
    await tick();
    expect(lastFrame()).toContain("probe · 1/2 up · every 60s");
    expect(changes).toEqual([
      ["db", true],
      ["db", false],
    ]);
  });

  it("sets the timeout of a service from its panel, down to the default again", async () => {
    const changes: [string, number | undefined][] = [];
    const passes: ServiceTimeouts[] = [];
    const { lastFrame, stdin } = open({
      check: async (_signal, _timeoutMs, _skipped, timeouts) => {
        passes.push(timeouts);
        return [api, db];
      },
      onTimeoutChange: (name, seconds) => {
        changes.push([name, seconds]);
      },
    });
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("j");
    await tick();
    stdin.write("l");
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("› Timeout  ‹ 2s ›");
    expect(lastFrame()).toContain("  Skip     ‹ no ›");
    expect(passes.at(-1)).toEqual({ api: 2 });
    stdin.write("h");
    await tick();
    stdin.write("h");
    await tick();
    stdin.write("h");
    await tick();
    expect(lastFrame()).toContain("› Timeout  ‹ default ›");
    expect(passes.at(-1)).toEqual({ api: undefined });
    expect(changes).toEqual([
      ["api", 1],
      ["api", 2],
      ["api", 1],
      ["api", undefined],
    ]);
  });

  it("starts with the timeouts the services already have, and steps from a value set by hand", async () => {
    const changes: [string, number | undefined][] = [];
    const { lastFrame, stdin } = open({
      timeouts: { api: 7 },
      onTimeoutChange: (name, seconds) => {
        changes.push([name, seconds]);
      },
    });
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(lastFrame()).toContain("Timeout  ‹ 7s ›");
    stdin.write("j");
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("› Timeout  ‹ 10s ›");
    expect(changes).toEqual([["api", 10]]);
  });

  it("moves down twice when two keys are read together", async () => {
    const cache: CheckResult = { ...api, name: "cache" };
    const { lastFrame, stdin } = open({ check: async () => [api, db, cache] });
    await waitFor(() => expect(lastFrame()).toContain("cache"));

    stdin.write("jj");

    await waitFor(() => expect(lastFrame()).toContain("› ✓ cache"));
  });

  it("moves down twice when a second key arrives before the screen is redrawn", async () => {
    const cache: CheckResult = { ...api, name: "cache" };
    const { lastFrame, stdin } = open({ check: async () => [api, db, cache] });
    await waitFor(() => expect(lastFrame()).toContain("cache"));

    stdin.write("j");
    stdin.write("j");

    await waitFor(() => expect(lastFrame()).toContain("› ✓ cache"));
  });

  it("moves down twice when the keys arrive while the list is being drawn", async () => {
    const cache: CheckResult = { ...api, name: "cache" };
    const { lastFrame, stdin, stdout } = open({ check: async () => [api, db, cache] });
    // Typing from inside the write of the frame: the render that drew it has not settled yet.
    const write = stdout.write;
    let typed = false;
    stdout.write = (frame: string) => {
      write(frame);
      if (typed || !frame.includes("cache")) return;
      typed = true;
      stdin.write("jj");
    };

    await waitFor(() => expect(lastFrame()).toContain("› ✓ cache"));
  });

  it("handles keys read together in order: open the panel, change twice, close", async () => {
    const changes: [string, number | undefined][] = [];
    const { lastFrame, stdin } = open({
      onTimeoutChange: (name, seconds) => {
        changes.push([name, seconds]);
      },
    });
    await waitFor(() => expect(lastFrame()).toContain("db"));

    stdin.write("j\rjll\r");

    await waitFor(() => {
      expect(changes).toEqual([
        ["db", 1],
        ["db", 2],
      ]);
      expect(lastFrame()).not.toContain("Timeout");
    });
  });

  it("says so when a change could not be saved, until a save goes through", async () => {
    const outcomes: (string | undefined)[] = [
      ".probe/local.yml cannot be edited safely",
      undefined,
    ];
    const { lastFrame, stdin } = open({ onSkipChange: async () => outcomes.shift() });
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("› Skip     ‹ yes ›");
    expect(lastFrame()).toContain("not saved: .probe/local.yml cannot be edited safely");
    stdin.write("h");
    await tick();
    expect(lastFrame()).not.toContain("not saved");
  });

  it("cuts an unsaved notice wider than the terminal", async () => {
    const { lastFrame, stdin } = open({
      onTimeoutChange: async () =>
        `EACCES: permission denied, open '/home/someone/${"deep/".repeat(20)}.probe/config.yml'`,
    });
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("j");
    await tick();
    stdin.write("l");
    await tick();
    const notice = lastFrame()
      ?.split("\n")
      .find((line) => line.startsWith("not saved"));
    expect(notice).toBeDefined();
    expect(notice?.length).toBeLessThanOrEqual(plain.columns ?? 0);
    expect(notice?.endsWith("…")).toBe(true);
  });

  it("shows a service as skipped before the pass that skips it ends", async () => {
    let passes = 0;
    const check = (signal: AbortSignal) => {
      passes += 1;
      if (passes === 1) return Promise.resolve([api, db]);
      return new Promise<CheckResult[]>((resolve) => {
        signal.addEventListener("abort", () => resolve([api, db]));
      });
    };
    const { lastFrame, stdin } = open({ check });
    await tick();
    stdin.write("j");
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("l");
    await tick();
    expect(passes).toBe(2);
    expect(lastFrame()).toContain("probe · 1/1 up · 1 skipped · every 60s");
  });

  it("starts with the services already set aside", async () => {
    const { lastFrame } = open({ check: checkUnlessSkipped, skipped: ["db"] });
    await tick();
    expect(lastFrame()).toContain("probe · 1/1 up · 1 skipped · every 60s");
  });

  it("opens the URL of the selected service on u and says what happened", async () => {
    const opened: string[] = [];
    const { lastFrame, stdin } = open({
      onOpen: async (name) => {
        opened.push(name);
        return `Opened ${name}`;
      },
    });
    await tick();

    stdin.write("j");
    await tick();
    stdin.write("u");
    await tick();

    expect(opened).toEqual(["db"]);
    expect(lastFrame()).toContain("Opened db");
  });

  it("copies the curl command of the selected service on c, with the timeout it has now", async () => {
    const copied: [string, number | undefined][] = [];
    const { lastFrame, stdin } = open({
      timeouts: { api: 5 },
      onCopy: async (name, timeout) => {
        copied.push([name, timeout]);
        return "Copied";
      },
    });
    await tick();

    stdin.write(ENTER);
    await tick();
    stdin.write("j");
    await tick();
    stdin.write("l");
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write("c");
    await tick();

    expect(copied).toEqual([["api", 10]]);
    expect(lastFrame()).toContain("Copied");
  });

  it("shows whole a command that could not be copied, on a narrow terminal", async () => {
    const command = "curl -i -L --max-time 3 http://localhost:3000/health";
    const { lastFrame, stdin } = open({
      terminal: { ...plain, columns: 30 },
      onCopy: async () => `Not copied: ${command}`,
    });
    await tick();

    stdin.write("c");
    await tick();

    expect(lastFrame()?.replaceAll("\n", " ")).toContain(command);
  });

  it("clears what u or c said at the next key", async () => {
    const { lastFrame, stdin } = open({ onOpen: async () => "Opened it" });
    await tick();
    stdin.write("u");
    await tick();

    stdin.write("j");
    await tick();

    expect(lastFrame()).not.toContain("Opened it");
  });

  it("ignores u and c while a panel is open", async () => {
    const calls: string[] = [];
    const { stdin } = open({
      onOpen: async (name) => `${calls.push(name)}`,
      onCopy: async (name) => `${calls.push(name)}`,
    });
    await tick();
    stdin.write("o");
    await tick();

    stdin.write("u");
    await tick();
    stdin.write("c");
    await tick();

    expect(calls).toEqual([]);
  });

  it("lists every key on ? and comes back to the list on ?", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("?");
    await tick();
    const left = [
      "List",
      "  ↑↓ jk   Move",
      "  r       Check now",
      "  ↵       Service detail",
      "  u       Open its URL",
      "  c       Copy curl command",
      "  e       Edit the service",
      "  d       Remove it",
      "  a       Add a service",
      "  /       Filter by name",
      "  :       Find a command",
      "  o       Options",
    ];
    const right = [
      "Panels",
      "  ↑↓ jk   Move",
      "  ←→ hl   Change the value",
      "  ↵       Set the variable",
      "  esc     Close",
      "Filter",
      "  ↑↓      Move",
      "  ↵       Keep the filter",
      "  esc     Clear it",
      "Add and edit",
      "  ↑↓ tab  Change field",
      "  ↵       Save",
      "  ctrl+u  Empty the field",
      "  esc     Cancel",
      "Outside a text field",
      "  ?       This help",
      "  q       Quit",
    ];
    const gutter = Math.max(...left.map((line) => line.length)) + 3;
    expect(lastFrame()).toBe(
      [
        "probe · keys",
        ...right.map((line, index) => `${(left[index] ?? "").padEnd(gutter)}${line}`),
        "? esc close · q quit",
      ].join("\n"),
    );
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("probe · 1/2 up");
  });

  it("closes the help on escape, back to the panel that was open", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("o?");
    await tick();
    expect(lastFrame()).not.toContain("│ Options");
    stdin.write(ESCAPE);
    await tick();
    expect(lastFrame()).toContain("│ Options");
  });

  it("ignores the keys of the list while the help is open", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("?jo");
    await tick();
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("› ✓ api");
    expect(lastFrame()).not.toContain("│ Options");
  });

  it("draws the help in ASCII, with no escape sequence, without unicode or colour", async () => {
    const { lastFrame, stdin } = open({ terminal: { ...plain, unicode: false } });
    await tick();
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("  enter   Service detail");
    expect(lastFrame()).toContain("  arrows  Move");
    expect(lastFrame()).toContain("? esc close - q quit");
    expect(lastFrame()).not.toContain(ESCAPE);
  });

  it("fits a 60-column terminal and follows a resize", async () => {
    const written: string[] = [];
    const stdout = Object.assign(new EventEmitter(), {
      columns: 60,
      rows: 24,
      isTTY: true,
      write: (frame: string) => written.push(frame),
    });
    const noop = () => {};
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setEncoding: noop,
      setRawMode: noop,
      resume: noop,
      pause: noop,
      ref: noop,
      unref: noop,
      read: () => null,
    });
    const frame = () => written.findLast((text) => text.includes("probe ")) ?? "";
    const lines = () => frame().split("\n");
    const long = { ...db, name: "payments-gateway", error: "expected 200 or 204, got 503" };
    const ink = inkRender(
      <Dashboard
        terminal={plain}
        settings={{ intervalMs: 60_000, timeoutMs: 3_000 }}
        check={async () => [api, long]}
      />,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        debug: true,
        patchConsole: false,
      },
    );
    try {
      await tick();
      expect(lines()).toContain("  ✗ payments-gateway  expected 200 or 204, got 503");
      for (const line of lines()) expect(line.length).toBeLessThanOrEqual(60);

      stdout.columns = 30;
      stdout.emit("resize");
      await tick();
      expect(lines()).toContain("  ✗ payments-ga…  expected 20…");
      expect(lines()).toContain("↵ service · ? help · q quit");
      for (const line of lines()) expect(line.length).toBeLessThanOrEqual(30);
    } finally {
      ink.unmount();
    }
  });
});

describe("dashboard service detail", () => {
  const answered: CheckResult = {
    ...api,
    response: {
      statusText: "OK",
      headers: [
        ["content-type", "application/json"],
        ["set-cookie", "(hidden)"],
      ],
      body: '{"status":"ok"}',
    },
  };
  const refused: CheckResult = {
    ...db,
    hint: "nothing listens on :5432: is the service started?",
  };

  it("shows the last response and the latencies above the settings", async () => {
    let pass = 0;
    const { lastFrame, stdin } = open({
      intervalMs: 20,
      check: async () => {
        pass += 1;
        return [{ ...answered, latencyMs: pass % 2 === 1 ? 2 : 8 }, refused];
      },
    });
    await tick();

    stdin.write(ENTER);

    await shows(lastFrame, "2–8ms");
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/│ 200 OK · [28]ms/);
    expect(frame).toMatch(/│ [▁█]+ 2–8ms/);
    expect(frame).toContain("│ content-type: application/json");
    expect(frame).toContain("│ set-cookie: (hidden)");
    expect(frame).toContain('│ {"status":"ok"}');
    expect(frame).toContain("│ › Skip     ‹ no ›");
  });

  it("shows the diagnosis of a service that is down, with what to try", async () => {
    const { lastFrame, stdin } = open({ check: async () => [answered, refused] });
    await tick();

    stdin.write(`j${ENTER}`);

    await shows(lastFrame, "│ connection refused");
    expect(lastFrame()).toContain("│ nothing listens on :5432: is the service started?");
  });

  it("keeps one line per service: the hint of the selected one is under the list", async () => {
    const { lastFrame, stdin } = open({ check: async () => [refused, answered] });
    await tick();
    expect(lastFrame()).toContain(
      [
        "› ✗ db   http://localhost:5432/        connection refused",
        "  ✓ api  http://localhost:3000/health  200  4ms",
        "http://localhost:5432/ · connection refused",
        "nothing listens on :5432: is the service started?",
      ].join("\n"),
    );

    stdin.write("j");

    await shows(lastFrame, "› ✓ api");
    expect(lastFrame()).not.toContain("nothing listens");
  });

  it("says a service set aside is not checked", async () => {
    const { lastFrame, stdin } = open({ check: async () => [answered, refused] });
    await tick();

    stdin.write(`${ENTER}l`);

    await shows(lastFrame, "│ skipped: not checked");
    expect(lastFrame()).not.toContain("content-type");
  });

  it("gives up headers and body lines on a short terminal, never the settings", async () => {
    const many: CheckResult = {
      ...answered,
      response: {
        statusText: "OK",
        headers: Array.from({ length: 6 }, (_, index): [string, string] => [`x-${index}`, "v"]),
        body: "one\ntwo\nthree\nfour",
      },
    };
    const services = Array.from({ length: 8 }, (_, index) => ({ ...many, name: `s${index}` }));
    const { lastFrame, stdin } = open({ check: async () => services });
    await tick();

    stdin.write(ENTER);

    await shows(lastFrame, "› Skip");
    const lines = (lastFrame() ?? "").split("\n");
    expect(lines.length).toBeLessThan(24);
    expect(lastFrame()).toMatch(/… \d more headers/);
    expect(lastFrame()).toContain("Timeout");
  });
});

describe("dashboard filter", () => {
  it("narrows the list while the name is typed", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write("/D");

    await shows(lastFrame, "Filter: D_");
    expect(lastFrame()).toBe(
      [
        "probe · 1/2 up · every 60s",
        "› ✗ db  http://localhost:5432/  connection refused",
        "http://localhost:5432/ · connection refused",
        "Filter: D_",
        "↑↓ move · ↵ keep · esc clear",
      ].join("\n"),
    );
  });

  it("takes q, ? and j as letters of the filter", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write("/q?j");

    await shows(lastFrame, "Filter: q?j_");
    expect(lastFrame()).toContain('no service matches "q?j"');
  });

  it("widens the list again on backspace", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("/dx");
    await shows(lastFrame, "Filter: dx_");

    stdin.write(BACKSPACE);

    await shows(lastFrame, "Filter: d_");
    expect(lastFrame()).toContain("✗ db");
  });

  it("shows every service again on escape", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write("/d");
    await shows(lastFrame, "Filter: d_");

    stdin.write(ESCAPE);

    await shows(lastFrame, "› ✓ api");
    expect(lastFrame()).toContain("/ filter");
  });

  it("keeps the filter on enter and gives the keys back to the list", async () => {
    const onOpen = vi.fn(async () => "Opened");
    const { lastFrame, stdin } = open({ onOpen });
    await tick();

    stdin.write(`/d${ENTER}u`);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("db"));
    expect(lastFrame()).toContain("probe · 1/2 up · every 60s · filter: d");
  });

  it("clears a kept filter on escape", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write(`/d${ENTER}`);
    await shows(lastFrame, "filter: d");

    stdin.write(ESCAPE);

    await hides(lastFrame, "filter: d");
    expect(lastFrame()).toContain("› ✓ api");
  });
});

describe("dashboard command palette", () => {
  it("lists every command with its key", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write(":");

    await shows(lastFrame, ": _");
    expect(lastFrame()).toBe(
      [
        "probe · 1/2 up · every 60s",
        "› ✓ api  http://localhost:3000/health  200  4ms",
        "  ✗ db   http://localhost:5432/        connection refused",
        "http://localhost:3000/health",
        ": _",
        "› Check now          r",
        "  Service detail     ↵",
        "  Open its URL       u",
        "  Copy curl command  c",
        "  Edit the service   e",
        "  Remove it          d",
        "  Add a service      a",
        "  Filter by name     /",
        "  Options            o",
        "  This help          ?",
        "  Quit               q",
        "↑↓ move · ↵ run · esc close",
      ].join("\n"),
    );
  });

  it("keeps the commands that say what is typed, whatever the case", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write(":CURL");

    await shows(lastFrame, ": CURL_");
    expect(lastFrame()).toContain("› Copy curl command  c");
    expect(lastFrame()).not.toContain("Quit");
  });

  it("runs the selected command on enter", async () => {
    const onCopy = vi.fn(async () => "Copied");
    const { lastFrame, stdin } = open({ onCopy });
    await tick();

    stdin.write(`j:curl${ENTER}`);

    await shows(lastFrame, "Copied");
    expect(onCopy).toHaveBeenCalledWith("db", undefined);
    expect(lastFrame()).not.toContain(": curl");
  });

  it("moves among the commands with the arrows", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write(`:${ESCAPE}[B${ESCAPE}[B${ESCAPE}[A${ENTER}`);

    await shows(lastFrame, "│ api");
    expect(lastFrame()).toContain("› Skip");
  });

  it("closes on escape without running anything, the dashboard still open", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write(":quit");
    await shows(lastFrame, "› Quit");

    stdin.write(ESCAPE);

    await hides(lastFrame, "› Quit");
    stdin.write("j");
    await shows(lastFrame, "› ✗ db");
  });

  it("leaves a kept filter in place on escape", async () => {
    const { lastFrame, stdin } = open({});
    await tick();
    stdin.write(`/d${ENTER}:`);
    await shows(lastFrame, ": _");

    stdin.write(ESCAPE);

    await hides(lastFrame, ": _");
    expect(lastFrame()).toContain("filter: d");
  });

  it("takes q, ? and j as letters", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write(":q?j");

    await shows(lastFrame, ": q?j_");
    expect(lastFrame()).toContain('no command matches "q?j"');
  });

  it("does nothing on enter when no command matches", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write(`:zzz${ENTER}`);

    await shows(lastFrame, 'no command matches "zzz"');
    await tick();
    expect(lastFrame()).toContain(": zzz_");
  });

  it("opens with no service, where the commands of a service do nothing", async () => {
    const onOpen = vi.fn(async () => "Opened");
    const { lastFrame, stdin } = open({ check: async () => [], onOpen });
    await tick();

    stdin.write(":its url");
    await shows(lastFrame, ": its url_");
    stdin.write(ENTER);

    await hides(lastFrame, ": its url_");
    await tick();
    expect(onOpen).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("no service");
  });

  it("takes : as a character in the filter and in the form", async () => {
    const { lastFrame, stdin } = open({ onServiceWrite: async () => SAVED });
    await tick();

    stdin.write("/a:");
    await shows(lastFrame, "Filter: a:_");
    stdin.write(ESCAPE);
    await hides(lastFrame, "Filter:");
    stdin.write("a:");

    await shows(lastFrame, "› Name    :_");
  });

  it("opens the help and the filter from the palette", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write(`:help${ENTER}`);
    await shows(lastFrame, "probe · keys");
    stdin.write(`?:filter${ENTER}d`);

    await shows(lastFrame, "Filter: d_");
  });

  it("scrolls the commands on a short terminal, the selected one in sight", async () => {
    const services = Array.from({ length: 14 }, (_, index) => ({ ...api, name: `s${index}` }));
    const { lastFrame, stdin } = open({ check: async () => services });
    await tick();

    stdin.write(`:${`${ESCAPE}[B`.repeat(10)}`);

    await shows(lastFrame, "› Quit");
    expect((lastFrame() ?? "").split("\n").length).toBeLessThan(24);
    expect(lastFrame()).not.toContain("Check now");
  });

  it("writes the commands and their keys in ASCII without unicode", async () => {
    const { lastFrame, stdin } = open({ terminal: { ...plain, unicode: false } });
    await tick();

    stdin.write(":");

    await shows(lastFrame, "> Check now          r");
    expect(lastFrame()).toContain("  Service detail     enter");
    expect(lastFrame()).toContain("arrows move - enter run - esc close");
  });
});

describe("dashboard service changes", () => {
  type Outcome = Awaited<ReturnType<NonNullable<DashboardProps["onServiceWrite"]>>>;

  function project(outcome: Outcome = SAVED) {
    let services = [api, db];
    const onServiceWrite = vi.fn<NonNullable<DashboardProps["onServiceWrite"]>>(async (write) => {
      if (outcome.saved && write.kind === "remove")
        services = services.filter(({ name }) => name !== write.name);
      if (outcome.saved && write.kind === "add")
        services = [...services, { ...api, name: write.name }];
      return outcome;
    });
    const serviceFields: DashboardProps["serviceFields"] = (name) =>
      name === "api"
        ? { host: "localhost", port: 3000, path: "/health", expect: undefined }
        : undefined;
    return { check: async () => services, onServiceWrite, serviceFields };
  }

  it("asks before removing the selected service", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write("d");

    await shows(lastFrame, "Remove api from the config?");
    expect(lastFrame()).toContain("y remove · n esc keep");
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it.each(["n", ESCAPE, "q", ENTER])("keeps the service when the answer is %j", async (answer) => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();
    stdin.write("d");
    await shows(lastFrame, "Remove api");

    stdin.write(answer);

    await hides(lastFrame, "Remove api");
    expect(onServiceWrite).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("› ✓ api");
  });

  it("removes the service on y and says so", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write("jdy");

    await shows(lastFrame, "Removed db");
    expect(onServiceWrite).toHaveBeenCalledWith({ kind: "remove", name: "db" });
    expect(lastFrame()).not.toContain("✗ db");
    await shows(lastFrame, "probe · 1/1 up");
  });

  it("removes the service the filter shows, not the one at that place in the full list", async () => {
    const { onServiceWrite, ...props } = project();
    const { stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`/d${ENTER}dy`);

    await waitFor(() =>
      expect(onServiceWrite).toHaveBeenCalledWith({ kind: "remove", name: "db" }),
    );
  });

  it("keeps the service on screen and says why when the removal is not saved", async () => {
    const { onServiceWrite, ...props } = project({
      saved: false,
      failure: "config.yml is read-only",
    });
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write("dy");

    await shows(lastFrame, "not saved: config.yml is read-only");
    expect(lastFrame()).toContain("› ✓ api");
    expect(lastFrame()).not.toContain("Removed api");
  });

  it("says what is left to do when the last service is removed", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();
    stdin.write("dy");
    await shows(lastFrame, "Removed api");

    stdin.write("dy");

    await shows(lastFrame, "no service: press a to add one");
  });

  it("opens an empty form on a", async () => {
    const { lastFrame, stdin } = open(project());
    await tick();

    stdin.write("a");

    await shows(lastFrame, "│ Add a service");
    const frame = lastFrame() ?? "";
    expect(frame).toContain("│ › Name    _ api");
    expect(frame).toContain("│   Port    3000");
    expect(frame).toContain("│   Expect  any 2xx");
    expect(frame).toContain("│   Header  Accept: application/json");
    expect(frame).toContain("↑↓ tab field · ↵ save · ctrl+u empty · esc cancel");
  });

  it("adds the service typed in the form, defaults for what is left empty", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`aweb${TAB}8080${ENTER}`);

    await shows(lastFrame, "Added web");
    expect(onServiceWrite).toHaveBeenCalledWith({
      kind: "add",
      name: "web",
      fields: { port: 8080, host: "localhost", path: "/", expect: undefined },
    });
    expect(lastFrame()).not.toContain("Add a service");
    await shows(lastFrame, "✓ web");
  });

  it("takes q, ?, j and k as letters of a field", async () => {
    const { lastFrame, stdin } = open(project());
    await tick();

    stdin.write("aq?jk");

    await shows(lastFrame, "› Name    q?jk_");
  });

  it("deletes the last character on backspace", async () => {
    const { lastFrame, stdin } = open(project());
    await tick();
    stdin.write("awebb");
    await shows(lastFrame, "› Name    webb_");

    stdin.write(BACKSPACE);

    await shows(lastFrame, "› Name    web_");
  });

  it("moves between the fields with the arrows", async () => {
    const { lastFrame, stdin } = open(project());
    await tick();

    stdin.write(`a${ESCAPE}[B${ESCAPE}[B${ESCAPE}[A8`);

    await shows(lastFrame, "› Port    8_");
  });

  it("shows the end of a value too long for the field", async () => {
    const { lastFrame, stdin } = open(project());
    await tick();
    const path = `/${"a".repeat(40)}/end`;

    stdin.write(`e${TAB}${TAB}${BACKSPACE.repeat(7)}${path}`);

    await shows(lastFrame, "/end_ │");
    expect(lastFrame()).toContain("› Path    …aaa");
  });

  it("reads every status typed in the last field", async () => {
    const { onServiceWrite, ...props } = project();
    const { stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`aweb${TAB}80${TAB}127.0.0.1${TAB}/up${TAB}200,204${ENTER}`);

    await waitFor(() =>
      expect(onServiceWrite).toHaveBeenCalledWith({
        kind: "add",
        name: "web",
        fields: { port: 80, host: "127.0.0.1", path: "/up", expect: [200, 204] },
      }),
    );
  });

  it("goes to the field that cannot be saved and says why, writing nothing", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`aweb${TAB}99999${TAB}${ENTER}`);

    await shows(lastFrame, "A port between 1 and 65535");
    expect(lastFrame()).toContain("› Port    99999_");
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it("refuses a name already used", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`adb${TAB}80${ENTER}`);

    await shows(lastFrame, "db already exists");
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it("closes the form on escape, writing nothing", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();
    stdin.write("aweb");
    await shows(lastFrame, "› Name    web_");

    stdin.write(ESCAPE);

    await hides(lastFrame, "Add a service");
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it("says where to edit a service the form cannot hold, instead of opening it", async () => {
    const serviceFields = () => "api is declared by `url`: edit it in .probe/config.yml";
    const { lastFrame, stdin } = open({ ...project(), serviceFields });
    await tick();

    stdin.write("e");

    await shows(lastFrame, "api is declared by `url`: edit it in .probe/config.yml");
    expect(lastFrame()).not.toContain("Edit api");
  });

  it("opens the form of the selected service on e, filled with what it has", async () => {
    const { lastFrame, stdin } = open(project());
    await tick();

    stdin.write("e");

    await shows(lastFrame, "│ Edit api");
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Name");
    expect(frame).toContain("│ › Port    3000_");
    expect(frame).toContain("│   Path    /health");
  });

  it("saves what the form changed on a service", async () => {
    const { onServiceWrite, ...props } = project();
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${BACKSPACE.repeat(4)}4000${ENTER}`);

    await shows(lastFrame, "Saved api");
    expect(onServiceWrite).toHaveBeenCalledWith({
      kind: "edit",
      name: "api",
      fields: { port: 4000, host: "localhost", path: "/health", expect: undefined },
    });
  });

  it("shows the warning that comes with a write", async () => {
    const warning = "the Makefile block was edited by hand, left as is.";
    const { lastFrame, stdin } = open(project({ saved: true, warning }));
    await tick();

    stdin.write(`aweb${TAB}80${ENTER}`);

    await shows(lastFrame, "Added web");
    expect(lastFrame()).toContain(warning);
  });

  it("checks again at once after a write", async () => {
    const { check, ...props } = project();
    const passes = vi.fn(check);
    const { stdin } = open({ ...props, check: passes });
    await tick();
    const before = passes.mock.calls.length;

    stdin.write("dy");

    await waitFor(() => expect(passes.mock.calls.length).toBe(before + 1));
  });

  it("leaves a, e and d without effect when the config cannot be written from here", async () => {
    const { lastFrame, stdin } = open({});
    await tick();

    stdin.write("aed");
    await tick(150);

    expect(lastFrame()).not.toContain("Add a service");
    expect(lastFrame()).not.toContain("Remove");
  });
});

describe("dashboard desktop notifications", () => {
  const flapping = (states: boolean[]): DashboardProps["check"] => {
    let pass = 0;
    return async () => {
      const ok = states[Math.min(pass, states.length - 1)] ?? true;
      pass += 1;
      return [{ ...api, ok }, db];
    };
  };
  const listener = (warning?: string) => {
    const told: string[] = [];
    const onNotify: DashboardProps["onNotify"] = async (message) => {
      told.push(message);
      return warning;
    };
    return { told, onNotify };
  };

  it("tells each change once, and nothing at start", async () => {
    const { told, onNotify } = listener();
    open({
      intervalMs: 20,
      notify: true,
      onNotify,
      check: flapping([true, true, false, false, false, true]),
    });

    await waitFor(() => expect(told).toEqual(["api is down", "api is back up"]));
    await tick(150);
    expect(told).toEqual(["api is down", "api is back up"]);
  });

  it("tells nothing while the option is off", async () => {
    const { told, onNotify } = listener();
    open({ intervalMs: 20, onNotify, check: flapping([true, false, true, false]) });

    await tick(250);
    expect(told).toEqual([]);
  });

  it("turns on from the options, saves it, and tells nothing that happened before", async () => {
    const { told, onNotify } = listener();
    const saved: DashboardSettings[] = [];
    const { lastFrame, stdin } = open({
      intervalMs: 20,
      onNotify,
      check: flapping([true, false]),
      onSettingsChange: (next) => {
        saved.push(next);
        return undefined;
      },
    });
    await shows(lastFrame, "0/2 up");

    stdin.write("o");
    await shows(lastFrame, "Options");
    stdin.write("j");
    await tick();
    stdin.write("j");
    await shows(lastFrame, "› Notify");
    stdin.write("l");
    await shows(lastFrame, "‹ on ›");

    expect(saved).toEqual([{ intervalMs: 20, timeoutMs: 3_000, notify: true }]);
    await tick(150);
    expect(told).toEqual([]);
  });

  it("warns once when no notification can be shown, and keeps checking", async () => {
    const warning = "notify-send could not show a desktop notification";
    const { told, onNotify } = listener(warning);
    let ok = true;
    const { lastFrame, stdin } = open({
      intervalMs: 20,
      notify: true,
      onNotify,
      check: async () => [{ ...api, ok }, db],
    });
    await shows(lastFrame, "1/2 up");

    ok = false;
    await shows(lastFrame, warning);
    expect(told).toEqual(["api is down"]);
    stdin.write("j");
    await hides(lastFrame, warning);

    ok = true;
    await waitFor(() => expect(told).toEqual(["api is down", "api is back up"]));
    await shows(lastFrame, "1/2 up");
    await tick(150);
    expect(lastFrame()).not.toContain(warning);
  });
});

describe("dashboard headers and variables", () => {
  const SECRET = "s3cr3t-token-0123456789";
  const reference = (name: string) => `$\{${name}}`;
  const DOWN = `${ESCAPE}[B`;
  const UP = `${ESCAPE}[A`;
  const CLEAR = String.fromCharCode(21);
  const ACCEPT = "Accept: text/plain";
  const fields = { host: "localhost", port: 3000, path: "/health", expect: undefined };

  function project(
    headers: Record<string, string> | undefined,
    sources: Record<string, "local" | "environment"> = {},
    refused: Record<string, string> = {},
  ) {
    const onServiceWrite = vi.fn<NonNullable<DashboardProps["onServiceWrite"]>>(async () => SAVED);
    const onVariableWrite = vi.fn<NonNullable<DashboardProps["onVariableWrite"]>>(
      async () => undefined,
    );
    const variables: DashboardProps["variables"] = {
      serviceVariables: async (name) =>
        name === "api"
          ? Object.values(headers ?? {})
              .flatMap((value) => Array.from(value.matchAll(/\$\{(\w+)\}/g), (match) => match[1]))
              .map((variable) => ({
                name: variable as string,
                source: sources[variable as string],
              }))
          : [],
      variableProblem: async (name) => refused[name],
      variableName: async (service, _header, taken) =>
        taken.includes(`${service.toUpperCase()}_TOKEN`)
          ? "OTHER"
          : `${service.toUpperCase()}_TOKEN`,
    };
    const serviceFields: DashboardProps["serviceFields"] = (name) =>
      name === "api" ? { ...fields, headers } : undefined;
    return { onServiceWrite, onVariableWrite, variables, serviceFields };
  }

  it("shows each header of the service on its line, with one more to add", async () => {
    const { lastFrame, stdin } = open(project({ Accept: "text/plain" }));
    await tick();

    stdin.write("e");

    await shows(lastFrame, "│ Edit api");
    expect(lastFrame()).toContain("│   Header  Accept: text/plain");
    expect(lastFrame()).toContain("│   Header  Accept: application/json");
  });

  it("writes the headers as they were when nothing was typed", async () => {
    const headers = { Authorization: `Bearer ${reference("API_TOKEN")}`, Accept: "text/plain" };
    const { onServiceWrite, ...props } = project(headers);
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${ENTER}`);

    await shows(lastFrame, "Saved api");
    expect(onServiceWrite).toHaveBeenCalledWith({
      kind: "edit",
      name: "api",
      fields: { ...fields, headers },
    });
  });

  it("adds the header typed on the last line", async () => {
    const { onServiceWrite, ...props } = project(undefined);
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}${ACCEPT}`);
    await shows(lastFrame, `│ › Header  ${ACCEPT}_`);
    expect(lastFrame()).toContain("Name: value. Emptied, it is removed.");
    stdin.write(ENTER);

    await shows(lastFrame, "Saved api");
    expect(onServiceWrite).toHaveBeenCalledWith({
      kind: "edit",
      name: "api",
      fields: { ...fields, headers: { Accept: "text/plain" } },
    });
  });

  it("removes the header emptied with ctrl+u", async () => {
    const { onServiceWrite, ...props } = project({ Accept: "text/plain", "X-Mode": "dev" });
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}${CLEAR}${ENTER}`);

    await shows(lastFrame, "Saved api");
    expect(onServiceWrite).toHaveBeenCalledWith({
      kind: "edit",
      name: "api",
      fields: { ...fields, headers: { "X-Mode": "dev" } },
    });
  });

  it("goes to the header that cannot be saved and says why", async () => {
    const { onServiceWrite, ...props } = project({ Accept: "text/plain" });
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(5)}accept: text/html${TAB}${ENTER}`);

    await shows(lastFrame, "accept is given twice");
    expect(lastFrame()).toContain("│ › Header  accept: text/html_");
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it("keeps a secret typed in clear off the screen and gives it a variable", async () => {
    const { onServiceWrite, ...props } = project(undefined);
    const { lastFrame, frames, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}Authorization: Bearer ${SECRET}`);
    await shows(lastFrame, `Authorization: Bearer ${"•".repeat(SECRET.length)}`.slice(-20));
    stdin.write(ENTER);
    await shows(lastFrame, "│ Authorization holds a secret");
    await shows(lastFrame, "│ › Variable  API_TOKEN_");
    expect(lastFrame()).toContain(`│ Authorization: Bearer ${reference("API_TOKEN")}`);
    expect(lastFrame()).toContain("↵ save · ctrl+u empty · esc cancel");
    stdin.write(ENTER);

    await shows(lastFrame, "Saved api, API_TOKEN kept in .probe/local.yml");
    expect(onServiceWrite).toHaveBeenCalledWith(
      {
        kind: "edit",
        name: "api",
        fields: { ...fields, headers: { Authorization: `Bearer ${reference("API_TOKEN")}` } },
      },
      { API_TOKEN: SECRET },
    );
    expect(frames.join("\n")).not.toContain(SECRET);
    expect(frames.join("\n")).not.toContain(SECRET.slice(0, 6));
  });

  it("hides a secret without unicode too, and shows a reference typed by hand", async () => {
    const { lastFrame, frames, stdin } = open({
      ...project(undefined),
      terminal: { ...plain, unicode: false },
    });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}X-Api-Key: ${SECRET}`);
    await shows(lastFrame, "*****_");
    stdin.write("$" + "{");
    await shows(lastFrame, `${"*".repeat(SECRET.length + 2)}_`);
    stdin.write(`${CLEAR}X-Api-Key: ${reference("KEY")}`);

    await shows(lastFrame, `> Header  X-Api-Key: ${reference("KEY")}_`);
    expect(frames.join("\n")).not.toContain(SECRET);
  });

  it("takes the name typed for the variable, and refuses one that is taken", async () => {
    const taken = "MINE is already sent by db: another name";
    const { onServiceWrite, ...props } = project(undefined, {}, { MINE: taken });
    const { lastFrame, frames, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}X-Api-Key: ${SECRET}${ENTER}`);
    await shows(lastFrame, "│ › Variable  API_TOKEN_");
    stdin.write(`${CLEAR}MINE${ENTER}`);
    await shows(lastFrame, taken);
    expect(onServiceWrite).not.toHaveBeenCalled();
    stdin.write(`${BACKSPACE.repeat(3)}Y_KEY${ENTER}`);

    await shows(lastFrame, "Saved api, MY_KEY kept in .probe/local.yml");
    expect(onServiceWrite).toHaveBeenCalledWith(
      {
        kind: "edit",
        name: "api",
        fields: { ...fields, headers: { "X-Api-Key": reference("MY_KEY") } },
      },
      { MY_KEY: SECRET },
    );
    expect(frames.join("\n")).not.toContain(SECRET);
  });

  it("asks a name for each secret, never the same twice", async () => {
    const { onServiceWrite, ...props } = project(undefined);
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(
      `e${DOWN.repeat(4)}Authorization: Basic ${SECRET}${DOWN}Cookie: sid=${SECRET}${ENTER}`,
    );
    await shows(lastFrame, "│ › Variable  API_TOKEN_");
    stdin.write(ENTER);
    await shows(lastFrame, "│ Cookie holds a secret");
    await shows(lastFrame, "│ › Variable  OTHER_");
    stdin.write(`${CLEAR}API_TOKEN${ENTER}`);
    await shows(lastFrame, "API_TOKEN already keeps another header");
    stdin.write(`${CLEAR}SID${ENTER}`);

    await shows(lastFrame, "Saved api, API_TOKEN, SID kept in .probe/local.yml");
    expect(onServiceWrite).toHaveBeenCalledWith(
      {
        kind: "edit",
        name: "api",
        fields: {
          ...fields,
          headers: { Authorization: `Basic ${reference("API_TOKEN")}`, Cookie: reference("SID") },
        },
      },
      { API_TOKEN: SECRET, SID: `sid=${SECRET}` },
    );
  });

  it("keeps the secret of a service that is added", async () => {
    const { onServiceWrite, ...props } = project(undefined);
    const { lastFrame, frames, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`aweb${TAB}8080${DOWN.repeat(4)}X-Api-Key: ${SECRET}${ENTER}`);
    await shows(lastFrame, "│ › Variable  WEB_TOKEN_");
    stdin.write(ENTER);

    await shows(lastFrame, "Added web, WEB_TOKEN kept in .probe/local.yml");
    expect(onServiceWrite).toHaveBeenCalledWith(
      {
        kind: "add",
        name: "web",
        fields: {
          host: "localhost",
          port: 8080,
          path: "/",
          expect: undefined,
          headers: { "X-Api-Key": reference("WEB_TOKEN") },
        },
      },
      { WEB_TOKEN: SECRET },
    );
    expect(frames.join("\n")).not.toContain(SECRET);
  });

  it("refuses for a secret the variable another header of the service sends", async () => {
    const { onServiceWrite, ...props } = project({ "X-Token": reference("API_TOKEN") });
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(5)}Authorization: Bearer ${SECRET}${ENTER}`);
    await shows(lastFrame, "│ › Variable  OTHER_");
    stdin.write(`${CLEAR}API_TOKEN${ENTER}`);

    await shows(lastFrame, "API_TOKEN already keeps another header");
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it("keeps no secret whose header was removed after it got its name", async () => {
    const { onServiceWrite, ...props } = project(undefined);
    const { lastFrame, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}X-Token: ${SECRET}${DOWN}Cookie: sid=${SECRET}${ENTER}`);
    await shows(lastFrame, "│ › Variable  API_TOKEN_");
    stdin.write(ENTER);
    await shows(lastFrame, "│ Cookie holds a secret");
    await shows(lastFrame, "│ › Variable  OTHER_");
    stdin.write(ESCAPE);
    await shows(lastFrame, "│ Edit api");
    stdin.write(`${CLEAR}${UP}${CLEAR}${ACCEPT}${ENTER}`);

    await shows(lastFrame, "Saved api");
    expect(lastFrame()).not.toContain("kept in");
    expect(onServiceWrite).toHaveBeenCalledWith({
      kind: "edit",
      name: "api",
      fields: { ...fields, headers: { Accept: "text/plain" } },
    });
  });

  it("comes back to the form on escape, the secret still hidden and nothing written", async () => {
    const { onServiceWrite, ...props } = project(undefined);
    const { lastFrame, frames, stdin } = open({ ...props, onServiceWrite });
    await tick();

    stdin.write(`e${DOWN.repeat(4)}X-Token: ${SECRET}${ENTER}`);
    await shows(lastFrame, "│ › Variable  API_TOKEN_");
    stdin.write(ESCAPE);

    await shows(lastFrame, "│ Edit api");
    expect(onServiceWrite).not.toHaveBeenCalled();
    expect(frames.join("\n")).not.toContain(SECRET);
  });

  it("does not say a secret is kept when keeping it failed", async () => {
    const props = project(undefined);
    props.onServiceWrite.mockResolvedValue({ saved: true, failure: ".probe/local.yml is broken" });
    const { lastFrame, stdin } = open(props);
    await tick();

    stdin.write(`e${DOWN.repeat(4)}X-Token: ${SECRET}${ENTER}`);
    await shows(lastFrame, "│ › Variable  API_TOKEN_");
    stdin.write(ENTER);

    await shows(lastFrame, "not saved: .probe/local.yml is broken");
    expect(lastFrame()).not.toContain("kept in");
  });

  it("asks for a reference where no variable can be kept", async () => {
    const { variables: _, ...props } = project(undefined);
    const { lastFrame, frames, stdin } = open(props);
    await tick();

    stdin.write(`e${DOWN.repeat(4)}X-Token: ${SECRET}${ENTER}`);

    await shows(lastFrame, "X-Token expects a reference");
    expect(props.onServiceWrite).not.toHaveBeenCalled();
    expect(frames.join("\n")).not.toContain(SECRET);
  });

  it("lists the variables of a service in its panel, with where each is set", async () => {
    const headers = {
      Authorization: `Bearer ${reference("API_TOKEN")}`,
      "X-Api-Key": reference("KEY"),
      Cookie: reference("SID"),
    };
    const { lastFrame, stdin } = open(project(headers, { KEY: "local", SID: "environment" }));
    await tick();

    stdin.write(ENTER);

    await shows(lastFrame, "│   API_TOKEN  not set");
    expect(lastFrame()).toContain("│   KEY        set in local.yml");
    expect(lastFrame()).toContain("│   SID        set in the environment");
    stdin.write(`${DOWN.repeat(2)}`);
    await shows(lastFrame, "│ › API_TOKEN  not set · ↵ sets it");
    stdin.write(DOWN);
    await shows(lastFrame, "│ › KEY        set in local.yml · ↵ changes it");
    stdin.write(`${DOWN}${DOWN}`);
    await shows(lastFrame, "│ › SID        set in the environment  ");
  });

  it("takes the value of a variable on enter, without drawing it", async () => {
    const { onVariableWrite, ...props } = project({ "X-Api-Key": reference("KEY") });
    const { lastFrame, frames, stdin } = open({ ...props, onVariableWrite });
    await tick();

    stdin.write(`${ENTER}${DOWN.repeat(2)}${ENTER}`);
    await shows(lastFrame, "Value of KEY: _");
    expect(lastFrame()).toContain("not shown, kept in .probe/local.yml on this machine only");
    stdin.write(SECRET);
    await shows(lastFrame, `Value of KEY: ${"•".repeat(SECRET.length)}_`);
    stdin.write(ENTER);

    await shows(lastFrame, "Kept KEY in .probe/local.yml, for this machine only");
    expect(onVariableWrite).toHaveBeenCalledWith("KEY", SECRET);
    expect(lastFrame()).toContain("│ › KEY");
    expect(frames.join("\n")).not.toContain(SECRET);
  });

  it("keeps nothing for an empty value or on escape", async () => {
    const { onVariableWrite, ...props } = project({ "X-Api-Key": reference("KEY") });
    const { lastFrame, stdin } = open({ ...props, onVariableWrite });
    await tick();

    stdin.write(`${ENTER}${DOWN.repeat(2)}${ENTER}${ENTER}`);
    await shows(lastFrame, "KEY expects a value");
    stdin.write(`abc${ESCAPE}`);

    await hides(lastFrame, "Value of KEY");
    expect(onVariableWrite).not.toHaveBeenCalled();
  });

  it("says a variable of the environment is not changed here", async () => {
    const { onVariableWrite, ...props } = project(
      { Cookie: reference("SID") },
      { SID: "environment" },
    );
    const { lastFrame, stdin } = open({ ...props, onVariableWrite });
    await tick();

    stdin.write(`${ENTER}${DOWN.repeat(2)}${ENTER}`);

    await shows(lastFrame, "SID comes from the environment, which is read first");
    expect(lastFrame()).not.toContain("Value of SID");
  });

  it("changes no setting with the arrows on a variable", async () => {
    const onSkipChange = vi.fn();
    const { lastFrame, stdin } = open({ ...project({ Cookie: reference("SID") }), onSkipChange });
    await tick();

    stdin.write(`${ENTER}${DOWN.repeat(2)}`);
    await shows(lastFrame, "│ › SID");
    stdin.write("l");
    await tick();

    expect(onSkipChange).not.toHaveBeenCalled();
  });
});
