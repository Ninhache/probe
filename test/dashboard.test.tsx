import { EventEmitter } from "node:events";
import { render as inkRender } from "ink";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { Dashboard } from "../src/dashboard/Dashboard";
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
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

let app: ReturnType<typeof render> | undefined;
afterEach(() => app?.unmount());

function open(options: {
  terminal?: Terminal;
  intervalMs?: number;
  check?: (signal: AbortSignal) => Promise<CheckResult[]>;
}) {
  app = render(
    <Dashboard
      terminal={options.terminal ?? plain}
      intervalMs={options.intervalMs ?? 60_000}
      check={options.check ?? (async () => [api, db])}
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
        "↑↓ jk move · r refresh · q quit",
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
    expect(lastFrame()).toContain("jk move - r refresh - q quit");
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
      <Dashboard terminal={plain} intervalMs={60_000} check={async () => [api, long]} />,
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
