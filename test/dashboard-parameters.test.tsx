import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { applySelection, type Selection } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import { serviceActions } from "../src/dashboard/actions";
import { Dashboard, type DashboardProps, type EnvironmentColumn } from "../src/dashboard/Dashboard";
import type { Terminal } from "../src/ui/terminal";

const plain: Terminal = {
  isTTY: true,
  color: false,
  columns: 100,
  hyperlinks: false,
  unicode: true,
};

const TENANTS = { tenant: ["acme", "globex"] };
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = <T,>(check: () => T) => vi.waitFor(check, { timeout: 10_000 });

const answer = (selection: Selection | undefined, host = "localhost:3000"): CheckResult[] => [
  {
    name: "api",
    type: "http",
    ok: true,
    target: `http://${host}/${selection?.tenant ?? "acme"}/health`,
    status: 200,
    latencyMs: 4,
  },
];

let app: ReturnType<typeof render> | undefined;
afterEach(() => app?.unmount());

function open(props: Partial<DashboardProps> = {}) {
  const check = vi.fn<DashboardProps["check"]>(async (_s, _t, _k, _o, selection) =>
    answer(selection),
  );
  app = render(
    <Dashboard
      terminal={plain}
      settings={{ intervalMs: 60_000, timeoutMs: 3_000 }}
      check={check}
      parameters={() => TENANTS}
      graceMs={0}
      {...props}
    />,
  );
  return { ...app, check };
}

describe("dashboard parameters", () => {
  it("should show a selector per parameter under the summary", async () => {
    const { lastFrame } = open({ parameters: () => ({ ...TENANTS, version: ["v1", "v2"] }) });
    await tick();

    const [summary, selectors] = lastFrame()?.split("\n") ?? [];
    expect(summary).toBe("probe · 1/1 up · every 60s");
    expect(selectors).toBe("tenant ‹ acme ›   version ‹ v1 ›");
    expect(lastFrame()).toContain("p parameters");
  });

  it("should check with the value chosen on the selector", async () => {
    const { lastFrame, stdin, check } = open();
    await tick();

    stdin.write("p");
    await waitFor(() => expect(lastFrame()).toContain("› tenant ‹ acme ›"));
    stdin.write("l");

    await waitFor(() => expect(lastFrame()).toContain("http://localhost:3000/globex/health"));
    expect(lastFrame()).toContain("› tenant ‹ globex ›");
    expect(check.mock.lastCall?.[4]).toEqual({ tenant: "globex" });
  });

  it("should start on the value chosen last time", async () => {
    const { lastFrame, check } = open({ selection: { tenant: "globex" } });

    await waitFor(() => expect(lastFrame()).toContain("tenant ‹ globex ›"));
    expect(check.mock.calls[0]?.[4]).toEqual({ tenant: "globex" });
  });

  it("should keep the first value when the one chosen last time is no longer listed", async () => {
    const { lastFrame } = open({ selection: { tenant: "initech" } });

    await waitFor(() => expect(lastFrame()).toContain("tenant ‹ acme ›"));
  });

  it("should save each value chosen", async () => {
    const onParameterChange = vi.fn(() => undefined);
    const { lastFrame, stdin } = open({ onParameterChange });
    await tick();

    stdin.write("pl");

    await waitFor(() => expect(lastFrame()).toContain("‹ globex ›"));
    expect(onParameterChange).toHaveBeenCalledWith("tenant", "globex");
  });

  it("should keep the selector being changed on screen when the line is too wide", async () => {
    const { lastFrame, stdin } = open({
      parameters: () => ({
        tenant: ["acme-international-holdings"],
        env: ["local-development-machine"],
        version: ["v1-long-term-support-release"],
      }),
    });
    await tick();

    stdin.write("pjj");

    await waitFor(() =>
      expect(lastFrame()?.split("\n")[1]).toBe(
        "… env ‹ local-development-machine ›   › version ‹ v1-long-term-support-release ›",
      ),
    );
  });

  it("should stop at the last value and close on p", async () => {
    const { lastFrame, stdin } = open();
    await tick();

    stdin.write("pll");
    await waitFor(() => expect(lastFrame()).toContain("› tenant ‹ globex ›"));
    stdin.write("p");

    await waitFor(() => expect(lastFrame()).toContain("\ntenant ‹ globex ›"));
    expect(lastFrame()).toContain("p parameters");
  });

  it("should open and copy with the chosen value", async () => {
    const onOpen = vi.fn(async () => "Opened");
    const onCopy = vi.fn(async () => "Copied");
    const { lastFrame, stdin } = open({ onOpen, onCopy });
    await tick();
    stdin.write("pl");
    await waitFor(() => expect(lastFrame()).toContain("‹ globex ›"));
    stdin.write("p");
    await waitFor(() => expect(lastFrame()).toContain("p parameters"));

    stdin.write("u");
    await waitFor(() => expect(lastFrame()).toContain("Opened"));
    stdin.write("c");
    await waitFor(() => expect(lastFrame()).toContain("Copied"));

    expect(onOpen).toHaveBeenCalledWith("api", { tenant: "globex" });
    expect(onCopy).toHaveBeenCalledWith("api", undefined, { tenant: "globex" });
  });

  it("should say so when the config declares no parameter", async () => {
    const { lastFrame, stdin } = open({ parameters: undefined });
    await tick();

    stdin.write("p");

    await waitFor(() => expect(lastFrame()).toContain(".probe/config.yml declares no parameter"));
    expect(lastFrame()).not.toContain("p parameters");
    expect(lastFrame()?.split("\n")[1]).toContain("api");
  });

  it("should not announce a change of state when the value changes", async () => {
    const told: string[] = [];
    const check = vi.fn<DashboardProps["check"]>(async (_s, _t, _k, _o, selection) =>
      answer(selection).map((result) => ({ ...result, ok: selection.tenant === "globex" })),
    );
    const { lastFrame, stdin } = open({
      check,
      settings: { intervalMs: 60_000, timeoutMs: 3_000, notify: true },
      onNotify: async (message) => {
        told.push(message);
        return undefined;
      },
    });
    await waitFor(() => expect(lastFrame()).toContain("0/1 up"));

    stdin.write("pl");
    await waitFor(() => expect(lastFrame()).toContain("1/1 up"));
    await tick();

    expect(told).toEqual([]);
  });

  it("should start the latencies again when the value changes", async () => {
    const { lastFrame, stdin } = open();
    await tick();
    stdin.write("r");
    await tick();
    stdin.write("pl");
    await waitFor(() => expect(lastFrame()).toContain("/globex/health"));
    stdin.write("p");
    await waitFor(() => expect(lastFrame()).toContain("p parameters"));

    stdin.write("\r");

    await waitFor(() => expect(lastFrame()).toContain("│ ▁ 4ms"));
  });
});

describe("dashboard parameters with environments", () => {
  const prod = (choices: Record<string, string[]>) => {
    const check = vi.fn<EnvironmentColumn["check"]>(async (_s, _t, selection) =>
      answer(selection, "example.com"),
    );
    const column: EnvironmentColumn = {
      name: "prod",
      file: ".probe/envs/prod.yml",
      check,
      parameters: () => choices,
    };
    return { column, check };
  };

  it("should apply one choice to every environment", async () => {
    const { column, check: checkProd } = prod(TENANTS);
    const { lastFrame, stdin, check } = open({ environments: [column] });
    await tick();

    stdin.write("pl");

    await waitFor(() => expect(checkProd.mock.lastCall?.[2]).toEqual({ tenant: "globex" }));
    expect(check.mock.lastCall?.[4]).toEqual({ tenant: "globex" });
    stdin.write("pl");
    await waitFor(() => expect(lastFrame()).toContain("prod · http://example.com/globex/health"));
  });

  it("should list the values of every environment", async () => {
    const { column } = prod({ tenant: ["acme", "initech"], version: ["v1"] });
    const { lastFrame } = open({ environments: [column] });

    await waitFor(() => expect(lastFrame()).toContain("tenant ‹ acme ›   version ‹ v1 ›"));
  });

  it("should say the value an environment uses when it does not list the one chosen", async () => {
    const { column } = prod({ tenant: ["acme"] });
    const { lastFrame, stdin } = open({ environments: [column] });
    await tick();
    stdin.write("pl");
    await waitFor(() => expect(lastFrame()).toContain("tenant ‹ globex ›"));
    stdin.write("p");

    stdin.write("l");

    await waitFor(() => expect(lastFrame()).toContain("tenant ‹ globex › · prod uses tenant=acme"));
  });
});

describe("the actions of a service with parameters", () => {
  const config: Config = {
    schemaVersion: 1,
    parameters: { env: { values: ["local", "prod"], strategy: { kind: "url" } } },
    services: {
      api: {
        host: "localhost",
        port: 3000,
        path: "/health",
        urls: { prod: "https://example.com/health" },
      },
    },
  };

  it("should open the address of the chosen value", async () => {
    const opened: string[] = [];
    const actions = serviceActions((selection) => applySelection(config, selection), {
      platform: "linux",
      env: {},
      openUrl: async (url) => opened.push(url) > 0,
      copyText: async () => true,
      notify: async () => true,
    });

    await actions.onOpen("api", { env: "prod" });
    await actions.onOpen("api", {});

    expect(opened).toEqual(["https://example.com/health", "http://localhost:3000/health"]);
  });
});
