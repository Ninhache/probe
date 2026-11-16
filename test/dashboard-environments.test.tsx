import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { Dashboard, type DashboardProps, type EnvironmentColumn } from "../src/dashboard/Dashboard";
import { formatGrid, type GridColumn } from "../src/dashboard/grid";
import { createColors } from "../src/ui/colors";
import type { Terminal } from "../src/ui/terminal";

const plain: Terminal = {
  isTTY: true,
  color: false,
  columns: 80,
  hyperlinks: false,
  unicode: true,
};

const up = (name: string, target: string, latencyMs = 4): CheckResult => ({
  name,
  type: "http",
  ok: true,
  target,
  status: 200,
  latencyMs,
});
const down = (name: string, target: string, error: string): CheckResult => ({
  name,
  type: "http",
  ok: false,
  target,
  latencyMs: 1,
  error,
});

const local = [
  up("api", "http://localhost:3000/health"),
  down("db", "http://localhost:5432/", "connection refused"),
];
const dev = [
  up("api", "https://dev.example.com/health", 120),
  up("db", "https://db.dev.example.com/", 80),
];
const prod = [
  down("api", "https://example.com/health", "expected 200, got 503"),
  up("front", "https://example.com/", 90),
];

const ESCAPE = String.fromCharCode(27);
const ENTER = "\r";
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = <T,>(check: () => T) => vi.waitFor(check, { timeout: 10_000 });

const column = (name: string, results: CheckResult[]): EnvironmentColumn => ({
  name,
  file: `.probe/envs/${name}.yml`,
  check: async () => results,
  onOpen: vi.fn(async (service: string) => `Opened ${name} ${service}`),
  onCopy: vi.fn(async (service: string) => `Copied ${name} ${service}`),
});

let app: ReturnType<typeof render> | undefined;
afterEach(() => app?.unmount());

function open(
  environments: EnvironmentColumn[],
  props: Partial<DashboardProps> = {},
  terminal: Terminal = plain,
) {
  app = render(
    <Dashboard
      terminal={terminal}
      settings={{ intervalMs: 60_000, timeoutMs: 3_000 }}
      check={async () => local}
      environments={environments}
      {...props}
    />,
  );
  return app;
}

describe("dashboard with environments", () => {
  it("shows one column per environment, aligned by service name", async () => {
    const { lastFrame } = open([column("dev", dev), column("prod", prod)]);
    await tick();
    expect(lastFrame()?.split("\n")).toEqual([
      "probe · 4/6 up · every 60s",
      "        local 1/2                 dev 2/2                   prod 1/2",
      "api   › ✓ 200 4ms                 ✓ 200 120ms               ✗ expected 200, got 503",
      "db      ✗ connection refused      ✓ 200 80ms",
      "front                                                       ✓ 200 90ms",
      "local · http://localhost:3000/health",
      "↑↓ jk move · ←→ hl environment · ↵ service · a add · / filter · : commands · ? help · q quit",
    ]);
  });

  it("moves between environments and names the one of the selected cell", async () => {
    const { lastFrame, stdin } = open([column("dev", dev), column("prod", prod)]);
    await tick();
    stdin.write("l");
    await waitFor(() => expect(lastFrame()).toContain("dev · https://dev.example.com/health"));
    stdin.write(`${ESCAPE}[C`);
    await waitFor(() =>
      expect(lastFrame()).toContain("prod · https://example.com/health · expected 200, got 503"),
    );
    expect(lastFrame()).toContain("› ✗ expected 200, got 503");
    stdin.write("l");
    stdin.write("h");
    await waitFor(() => expect(lastFrame()).toContain("dev · https://dev.example.com/health"));
  });

  it("says where a service is missing and acts on nothing from an empty cell", async () => {
    const dev1 = column("dev", dev);
    const onOpen = vi.fn(async () => "Opened");
    const { lastFrame, stdin } = open([dev1, column("prod", prod)], { onOpen });
    await tick();
    stdin.write("jj");
    await waitFor(() => expect(lastFrame()).toContain("local · front is not in .probe/config.yml"));
    stdin.write("u");
    stdin.write("c");
    stdin.write(ENTER);
    stdin.write("l");
    await waitFor(() => expect(lastFrame()).toContain("dev · front is not in .probe/envs/dev.yml"));
    stdin.write("u");
    await tick();
    expect(onOpen).not.toHaveBeenCalled();
    expect(dev1.onOpen).not.toHaveBeenCalled();
    expect(lastFrame()).not.toContain("┌");
  });

  it("opens and copies the service of the selected environment", async () => {
    const prod1 = column("prod", prod);
    const onOpen = vi.fn(async () => "Opened local");
    const onCopy = vi.fn(async () => "Copied local");
    const { lastFrame, stdin } = open([prod1], { onOpen, onCopy });
    await tick();
    stdin.write("l");
    stdin.write("u");
    await waitFor(() => expect(lastFrame()).toContain("Opened prod api"));
    stdin.write("c");
    await waitFor(() => expect(lastFrame()).toContain("Copied prod api"));
    expect(prod1.onOpen).toHaveBeenCalledWith("api");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("writes nothing local from the cell of another environment", async () => {
    const onServiceWrite = vi.fn(async () => ({ saved: true }));
    const onSkipChange = vi.fn();
    const onTimeoutChange = vi.fn();
    const onVariableWrite = vi.fn(async () => undefined);
    const serviceFields = vi.fn(() => ({ host: "localhost", port: 3000, path: "/" }));
    const variables = {
      serviceVariables: vi.fn(async () => [{ name: "API_TOKEN" }]),
      variableProblem: async () => undefined,
      variableName: async () => "API_TOKEN",
    };
    const { lastFrame, stdin } = open([column("prod", prod)], {
      onServiceWrite,
      onSkipChange,
      onTimeoutChange,
      onVariableWrite,
      serviceFields,
      variables,
    });
    await tick();
    stdin.write("l");
    for (const key of ["e", "d", "a"]) {
      stdin.write(key);
      await waitFor(() =>
        expect(lastFrame()).toContain("prod is not edited here: change .probe/envs/prod.yml"),
      );
      stdin.write("y");
      await tick();
    }
    stdin.write(ENTER);
    await waitFor(() => expect(lastFrame()).toContain("api · prod"));
    expect(lastFrame()).not.toContain("Skip");
    expect(lastFrame()).not.toContain("Timeout");
    expect(lastFrame()).not.toContain("API_TOKEN");
    for (const key of ["l", "h", "j", "l", "j", "j", ENTER]) stdin.write(key);
    await tick();
    expect(lastFrame()).not.toContain("Value of");
    expect(onServiceWrite).not.toHaveBeenCalled();
    expect(onSkipChange).not.toHaveBeenCalled();
    expect(onTimeoutChange).not.toHaveBeenCalled();
    expect(onVariableWrite).not.toHaveBeenCalled();
    expect(serviceFields).not.toHaveBeenCalled();
    expect(variables.serviceVariables).not.toHaveBeenCalled();
  });

  it("keeps the local skip of a service away from its namesake elsewhere", async () => {
    const { lastFrame } = open([column("dev", dev)], { skipped: ["api"] });
    await tick();
    expect(lastFrame()).toContain("api › - skipped                 ✓ 200 120ms");
    expect(lastFrame()).toContain("probe · 2/3 up · 1 skipped");
  });

  it("goes on when the file of an environment cannot be read, and reads it again", async () => {
    let broken = true;
    const flaky: EnvironmentColumn = {
      ...column("prod", prod),
      check: async () => {
        if (broken) throw new Error(".probe/envs/prod.yml is invalid: services.api needs a port");
        return prod;
      },
    };
    const { lastFrame, stdin } = open([flaky]);
    await tick();
    expect(lastFrame()).toContain("local 1/2");
    expect(lastFrame()).toContain("prod !");
    stdin.write("l");
    await waitFor(() =>
      expect(lastFrame()).toContain(
        "prod · .probe/envs/prod.yml is invalid: services.api needs a port",
      ),
    );
    broken = false;
    stdin.write("r");
    await waitFor(() => expect(lastFrame()).toContain("prod 1/2"));
    expect(lastFrame()).not.toContain("is invalid");
  });

  it("names the environment in a notification", async () => {
    const told: string[] = [];
    let pass = 0;
    const flapping: EnvironmentColumn = {
      ...column("prod", prod),
      check: async () => {
        pass += 1;
        return pass === 1
          ? [up("api", "https://example.com/health")]
          : [down("api", "https://example.com/health", "expected 200, got 503")];
      },
    };
    const { stdin } = open([flapping], {
      settings: { intervalMs: 60_000, timeoutMs: 3_000, notify: true },
      onNotify: async (message) => {
        told.push(message);
        return undefined;
      },
    });
    await tick();
    stdin.write("r");
    await waitFor(() => expect(told).toEqual(["prod/api is down"]));
  });

  it("shows the detail of a service of another environment, with its own history", async () => {
    const answered = { ...dev[0], response: { statusText: "OK", headers: [], body: "dev-body" } };
    const { lastFrame, stdin } = open([column("dev", [answered as CheckResult])]);
    await tick();
    stdin.write("l");
    stdin.write(ENTER);
    await waitFor(() => expect(lastFrame()).toContain("api · dev"));
    expect(lastFrame()).toContain("dev-body");
    expect(lastFrame()).toContain("120ms");
  });

  it("draws the grid in ASCII with no escape sequence, without unicode or colour", async () => {
    const { lastFrame, stdin, frames } = open(
      [column("dev", dev)],
      {},
      { ...plain, unicode: false },
    );
    await tick();
    stdin.write("l");
    await waitFor(() => expect(lastFrame()).toContain("> ✓ 200 120ms"));
    expect(lastFrame()).toContain("jk move - hl environment");
    expect(frames.join("")).not.toContain(ESCAPE);
  });

  it("lists the key that changes environment in the help", async () => {
    const { lastFrame, stdin } = open([column("dev", dev)]);
    await tick();
    stdin.write("?");
    await waitFor(() => expect(lastFrame()).toContain("Change environment"));
  });
});

describe("formatGrid", () => {
  const colors = createColors(false);
  const columns: GridColumn[] = [
    { name: "local", results: local },
    { name: "dev", results: dev },
    { name: "prod", results: prod },
  ];
  const names = ["api", "db", "front"];

  it("fits three environments in 80 columns", () => {
    const { header, rows, hidden } = formatGrid(
      names,
      columns,
      { row: 0, column: 2 },
      { width: 80, unicode: true, colors },
    );
    expect(hidden).toBe(0);
    expect([header, ...rows].map((line) => line.trimEnd())).toEqual([
      "        local 1/2               dev 2/2                 prod 1/2",
      "api     ✓ 200 4ms               ✓ 200 120ms           › ✗ expected 200, got …",
      "db      ✗ connection refused    ✓ 200 80ms",
      "front                                                   ✓ 200 90ms",
    ]);
    for (const line of [header, ...rows]) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("tells up, down, skipped, absent and pending apart without colour", () => {
    const skipped: CheckResult = { ...local[0], skipped: true } as CheckResult;
    const { header, rows } = formatGrid(
      ["api", "db"],
      [
        { name: "local", results: [skipped, local[1] as CheckResult] },
        { name: "dev", results: [dev[0] as CheckResult] },
        { name: "prod" },
        { name: "qa", problem: "unreadable" },
      ],
      { row: 1, column: 1 },
      { width: 100, unicode: false, colors },
    );
    expect(header.trimEnd()).toBe(
      "      local 0/1               dev 1/1                 prod                    qa !",
    );
    expect(rows.map((row) => row.trimEnd())).toEqual([
      "api   - skipped               ✓ 200 120ms             ...",
      "db    ✗ connection refused  >                         ...",
    ]);
  });

  it("keeps the selected column on screen when they do not all fit", () => {
    const many = ["dev", "qa", "staging", "prod"].map((name) => ({ name, results: dev }));
    const drawn = (column: number) =>
      formatGrid(
        names,
        [columns[0] as GridColumn, ...many],
        { row: 0, column },
        {
          width: 40,
          unicode: true,
          colors,
        },
      );
    expect(drawn(0).hidden).toBe(2);
    expect(drawn(0).header).toContain("local");
    expect(drawn(0).header).not.toContain("prod");
    expect(drawn(4).header).toContain("prod");
    expect(drawn(4).header).not.toContain("local");
    for (const line of [drawn(4).header, ...drawn(4).rows])
      expect(line.length).toBeLessThanOrEqual(40);
  });

  it("drops the latency before it cuts the status", () => {
    const { rows } = formatGrid(
      ["api"],
      [{ name: "dev", results: [up("api", "https://dev.example.com/", 12345)] }],
      { row: 0, column: 0 },
      { width: 14, unicode: true, colors },
    );
    expect(rows[0]?.trimEnd()).toBe("api › ✓ 200");
  });
});
