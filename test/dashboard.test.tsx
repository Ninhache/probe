import { EventEmitter } from "node:events";
import { render as inkRender } from "ink";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
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
/** Checks like the real runner: a skipped service is reported, not checked. */
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
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

let app: ReturnType<typeof render> | undefined;
afterEach(() => app?.unmount());

function open(options: {
  terminal?: Terminal;
  intervalMs?: number;
  skipped?: string[];
  timeouts?: ServiceTimeouts;
  check?: DashboardProps["check"];
  onTimeoutChange?: (name: string, seconds: number | undefined) => void;
  onSettingsChange?: (settings: DashboardSettings) => void;
  onSkipChange?: (name: string, skip: boolean) => void;
}) {
  app = render(
    <Dashboard
      terminal={options.terminal ?? plain}
      settings={{ intervalMs: options.intervalMs ?? 60_000, timeoutMs: 3_000 }}
      check={options.check ?? (async () => [api, db])}
      skipped={options.skipped}
      timeouts={options.timeouts}
      onTimeoutChange={options.onTimeoutChange}
      onSettingsChange={options.onSettingsChange}
      onSkipChange={options.onSkipChange}
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
        "↑↓ jk move · r refresh · ↵ service · o options · q quit",
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
    expect(lastFrame()).toContain("jk move - r refresh - enter service - o options - q quit");
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
        "└────────────────────────────┘",
        "↑↓ jk move · ←→ hl change · esc close",
      ].join("\n"),
    );
    stdin.write(ESCAPE);
    await tick(150);
    expect(lastFrame()).not.toContain("Options");
    expect(lastFrame()).toContain("o options");
  });

  it("changes the interval from the options, within the choices", async () => {
    const changes: DashboardSettings[] = [];
    const { lastFrame, stdin } = open({ onSettingsChange: (next) => changes.push(next) });
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
    expect(lastFrame()).toContain("jk move - hl change - esc close");
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
        "┌────────────────────────────┐",
        "│ db                         │",
        "│ › Skip     ‹ no ›          │",
        "│   Timeout  ‹ default ›     │",
        "└────────────────────────────┘",
        "↑↓ jk move · ←→ hl change · esc close",
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
      onSkipChange: (name, skip) => changes.push([name, skip]),
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
      onTimeoutChange: (name, seconds) => changes.push([name, seconds]),
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
      onTimeoutChange: (name, seconds) => changes.push([name, seconds]),
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
      for (const line of lines()) expect(line.length).toBeLessThanOrEqual(30);
    } finally {
      ink.unmount();
    }
  });
});
