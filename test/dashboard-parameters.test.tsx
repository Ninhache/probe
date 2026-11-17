import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { applySelection, type Selection } from "../src/config/parameters";
import type { Config, Parameter } from "../src/config/schema";
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
    stdin.write("j");

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

    stdin.write("pj");

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

    stdin.write("pll");

    await waitFor(() =>
      expect(lastFrame()?.split("\n")[1]).toBe(
        "… env ‹ local-development-machine ›   › version ‹ v1-long-term-support-release ›",
      ),
    );
  });

  it("should show the parameters as tabs and the values as a list", async () => {
    const { lastFrame, stdin } = open({
      parameters: () => ({ ...TENANTS, version: ["v1", "v2"] }),
    });
    await tick();

    stdin.write("pl");

    await waitFor(() => expect(lastFrame()).toContain("│  tenant  [version]"));
    expect(lastFrame()).toContain("│ › v1");
    expect(lastFrame()).toContain("│   v2");
    expect(lastFrame()).toContain(
      "←→ hl parameter · ↑↓ jk value · a add · e edit · d remove · p esc close",
    );
  });

  it("should stop at the last value and close on p", async () => {
    const { lastFrame, stdin } = open();
    await tick();

    stdin.write("pjj");
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
    stdin.write("pj");
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

    stdin.write("pj");
    await waitFor(() => expect(lastFrame()).toContain("1/1 up"));
    await tick();

    expect(told).toEqual([]);
  });

  it("should start the latencies again when the value changes", async () => {
    const { lastFrame, stdin } = open();
    await tick();
    stdin.write("r");
    await tick();
    stdin.write("pj");
    await waitFor(() => expect(lastFrame()).toContain("/globex/health"));
    stdin.write("p");
    await waitFor(() => expect(lastFrame()).toContain("p parameters"));

    stdin.write("\r");

    await waitFor(() => expect(lastFrame()).toContain("│ ▁ 4ms"));
  });
});

describe("dashboard parameter editing", () => {
  const DOWN = "\u001B[B";
  const TENANT: Parameter = { values: ["acme", "globex"], strategy: { kind: "query", name: "t" } };
  const saved = () =>
    vi.fn<NonNullable<DashboardProps["onParameterWrite"]>>(async () => ({ saved: true }));

  it("should open the panel to add the first parameter when none is declared", async () => {
    const { lastFrame, stdin } = open({ parameters: undefined, onParameterWrite: saved() });
    await tick();

    stdin.write("p");

    await waitFor(() => expect(lastFrame()).toContain("None yet: a adds one"));
    expect(lastFrame()).toContain("a add · p esc close");
  });

  it("should add a parameter typed in the form", async () => {
    const onParameterWrite = saved();
    const { lastFrame, stdin } = open({ onParameterWrite });
    await tick();
    stdin.write("pa");
    await waitFor(() => expect(lastFrame()).toContain("Add a parameter"));

    stdin.write("version");
    stdin.write(DOWN);
    stdin.write("v1, v2");
    stdin.write("\r");

    await waitFor(() => expect(lastFrame()).toContain("Added version"));
    expect(onParameterWrite).toHaveBeenCalledWith({
      kind: "add",
      name: "version",
      parameter: { values: ["v1", "v2"], strategy: { kind: "query", name: "version" } },
    });
  });

  it("should choose how the parameter is sent with the arrows or its first letter", async () => {
    const onParameterWrite = saved();
    const { lastFrame, stdin } = open({ onParameterWrite });
    await tick();
    stdin.write("pa");
    await waitFor(() => expect(lastFrame()).toContain("Add a parameter"));
    stdin.write(`team${DOWN}a${DOWN}`);
    await waitFor(() => expect(lastFrame()).toContain("› Sent by  ‹ query ›"));

    stdin.write("\u001B[C");
    await waitFor(() => expect(lastFrame()).toContain("‹ path ›"));
    stdin.write(`h${DOWN}X-Team\r`);

    await waitFor(() => expect(lastFrame()).toContain("Added team"));
    expect(onParameterWrite.mock.lastCall?.[0]).toMatchObject({
      parameter: { values: ["a"], strategy: { kind: "header", name: "X-Team" } },
    });
  });

  it("should ask for no name when the value goes in the path", async () => {
    const { lastFrame, stdin } = open({ onParameterWrite: saved() });
    await tick();
    stdin.write("pa");
    await waitFor(() => expect(lastFrame()).toContain("› Name"));
    expect(lastFrame()).toContain("Query");

    stdin.write(`team${DOWN}a${DOWN}p`);

    await waitFor(() => expect(lastFrame()).toContain("‹ path ›"));
    expect(lastFrame()).not.toMatch(/Query|Header/);
  });

  it("should point at the field to fix before writing anything", async () => {
    const onParameterWrite = saved();
    const { lastFrame, stdin } = open({ onParameterWrite });
    await tick();
    stdin.write("pa");
    await waitFor(() => expect(lastFrame()).toContain("Add a parameter"));

    stdin.write("version\r");

    await waitFor(() => expect(lastFrame()).toContain("One value or more, e.g. acme, globex"));
    expect(lastFrame()).toContain("› Values");
    expect(onParameterWrite).not.toHaveBeenCalled();
  });

  it("should keep the form open on what the config refuses", async () => {
    const onParameterWrite = vi.fn<NonNullable<DashboardProps["onParameterWrite"]>>(async () => ({
      saved: false,
      problem: { field: "strategyName", message: "Sets the same query as tenant" },
    }));
    const { lastFrame, stdin } = open({ onParameterWrite });
    await tick();
    stdin.write("pa");
    await waitFor(() => expect(lastFrame()).toContain("Add a parameter"));

    stdin.write(`team${DOWN}a${DOWN}${DOWN}t\r`);

    await waitFor(() => expect(lastFrame()).toContain("Sets the same query as tenant"));
    expect(lastFrame()).toContain("› Query");
  });

  it("should edit a parameter from its values", async () => {
    const onParameterWrite = saved();
    const { lastFrame, stdin } = open({ onParameterWrite, parameterFields: () => TENANT });
    await tick();
    stdin.write("pe");
    await waitFor(() => expect(lastFrame()).toContain("Edit tenant"));
    expect(lastFrame()).toContain("acme, globex");

    stdin.write(", initech\r");

    await waitFor(() => expect(lastFrame()).toContain("Saved tenant"));
    expect(onParameterWrite).toHaveBeenCalledWith({
      kind: "edit",
      name: "tenant",
      parameter: { values: ["acme", "globex", "initech"], strategy: { kind: "query", name: "t" } },
    });
  });

  it("should remove a parameter on y only, and no service", async () => {
    const onParameterWrite = saved();
    const onServiceWrite = vi.fn<NonNullable<DashboardProps["onServiceWrite"]>>();
    const { lastFrame, stdin } = open({
      onParameterWrite,
      onServiceWrite,
      parameterFields: () => TENANT,
    });
    await tick();
    stdin.write("pd");
    await waitFor(() =>
      expect(lastFrame()).toContain("Remove the parameter tenant from the config?"),
    );
    stdin.write("n");
    await tick();
    expect(onParameterWrite).not.toHaveBeenCalled();

    stdin.write("dy");

    await waitFor(() => expect(lastFrame()).toContain("Removed tenant"));
    expect(onParameterWrite).toHaveBeenCalledWith({ kind: "remove", name: "tenant" });
    expect(onServiceWrite).not.toHaveBeenCalled();
  });

  it("should say which file declares a parameter of another environment", async () => {
    const column: EnvironmentColumn = {
      name: "prod",
      file: ".probe/envs/prod.yml",
      check: async (_s, _t, selection) => answer(selection, "example.com"),
      parameters: () => ({ region: ["eu"] }),
    };
    const { lastFrame, stdin } = open({
      parameters: undefined,
      environments: [column],
      onParameterWrite: saved(),
      parameterFields: () => undefined,
    });
    await tick();

    stdin.write("pe");

    await waitFor(() =>
      expect(lastFrame()).toContain(
        "region is not in .probe/config.yml: change it in .probe/envs/prod.yml",
      ),
    );
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

    stdin.write("pj");

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
    stdin.write("pj");
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

describe("dashboard parameter addresses", () => {
  const DOWN = "\u001B[B";
  const ENV: Parameter = { values: ["dev", "prod"], strategy: { kind: "url" } };
  const ADDRESSES = { api: { prod: "https://example.com/health" }, db: {} };

  function openEnv(onParameterWrite: NonNullable<DashboardProps["onParameterWrite"]>) {
    return open({
      parameters: () => ({ env: ["dev", "prod"] }),
      parameterFields: () => ENV,
      addresses: () => ADDRESSES,
      onParameterWrite,
    });
  }

  it("should list a line per service and value when the parameter is sent by url", async () => {
    const { lastFrame, stdin } = openEnv(vi.fn(async () => ({ saved: true })));
    await tick();

    stdin.write("pe");

    await waitFor(() => expect(lastFrame()).toContain("Addresses (empty: the service address)"));
    expect(lastFrame()).toContain("api dev");
    expect(lastFrame()).toContain("    prod  https://example.com/health");
    expect(lastFrame()).toContain("db  dev");
  });

  it("should send the addresses typed, with http:// when none is given", async () => {
    const onParameterWrite = vi.fn<NonNullable<DashboardProps["onParameterWrite"]>>(async () => ({
      saved: true,
    }));
    const { lastFrame, stdin } = openEnv(onParameterWrite);
    await tick();
    stdin.write("pe");
    await waitFor(() => expect(lastFrame()).toContain("Addresses"));

    stdin.write(`${DOWN}${DOWN}localhost:3001\r`);

    await waitFor(() => expect(lastFrame()).toContain("Saved env"));
    expect(onParameterWrite.mock.lastCall?.[0]).toMatchObject({
      kind: "edit",
      addresses: { api: { dev: "http://localhost:3001" } },
    });
  });

  it("should point at an address the config would refuse", async () => {
    const onParameterWrite = vi.fn<NonNullable<DashboardProps["onParameterWrite"]>>(async () => ({
      saved: true,
    }));
    const { lastFrame, stdin } = openEnv(onParameterWrite);
    await tick();
    stdin.write("pe");
    await waitFor(() => expect(lastFrame()).toContain("Addresses"));

    stdin.write(`${DOWN}${DOWN}ftp://example.com\r`);

    await waitFor(() =>
      expect(lastFrame()).toContain("api dev: expects an http:// or https:// URL"),
    );
    expect(onParameterWrite).not.toHaveBeenCalled();
  });

  it("should write the addresses of a removed value only once confirmed", async () => {
    const onParameterWrite = vi.fn<NonNullable<DashboardProps["onParameterWrite"]>>(
      async (write) =>
        write.kind !== "remove" && !write.confirmed
          ? { saved: false, drops: ["api prod"] }
          : { saved: true },
    );
    const { lastFrame, stdin } = openEnv(onParameterWrite);
    await tick();
    stdin.write("pe");
    await waitFor(() => expect(lastFrame()).toContain("Addresses"));

    stdin.write("\u0015dev\r");
    await waitFor(() => expect(lastFrame()).toContain("Remove 1 address: api prod?"));
    stdin.write("n");
    await waitFor(() => expect(lastFrame()).toContain("Edit env"));
    expect(lastFrame()).toContain("› Values   dev");
    stdin.write("\r");
    await waitFor(() => expect(lastFrame()).toContain("Remove 1 address"));
    stdin.write("y");

    await waitFor(() => expect(lastFrame()).toContain("Saved env"));
    expect(onParameterWrite.mock.lastCall?.[0]).toMatchObject({ confirmed: true });
  });

  it("should keep the addresses typed when the way of sending changes and comes back", async () => {
    const { lastFrame, stdin } = openEnv(vi.fn(async () => ({ saved: true })));
    await tick();
    stdin.write("pe");
    await waitFor(() => expect(lastFrame()).toContain("Addresses"));
    stdin.write(`${DOWN}${DOWN}dev.example.com`);
    await waitFor(() => expect(lastFrame()).toContain("dev.example.com"));

    stdin.write("\u001B[Aq");
    await waitFor(() => expect(lastFrame()).not.toContain("Addresses"));
    stdin.write("u");

    await waitFor(() => expect(lastFrame()).toContain("dev.example.com"));
  });
});
