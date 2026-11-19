import { describe, expect, it, vi } from "vitest";
import { serviceType } from "../src/checkers/registry";
import { runChecks } from "../src/checkers/run";
import type { ServiceType } from "../src/checkers/types";
import { applySelection } from "../src/config/parameters";
import { configSchemaV1, type Service } from "../src/config/schema";
import { serviceActions } from "../src/dashboard/actions";
import { detailLines } from "../src/dashboard/detail";
import { type EditCallbacks, liveEditing } from "../src/dashboard/editing";
import { createEditor } from "../src/dashboard/native/editor";
import { Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import { platformFor } from "../src/platform";
import { parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import { formatCheckResults } from "../src/ui/report";

// A type with no URL, no headers and no command: what the dashboard and `check` know must come from it.
const socket: ServiceType = {
  type: "socket",
  target: (service: Service) => `socket ${service.host}:${service.port}`,
  form: {
    fields: [{ key: "port", label: "Port", placeholder: "5432" }],
    read: ({ port }) => ({ port: String(port) }),
    problem: (key, value) => (key === "port" && !/^\d+$/.test(value) ? "A port number" : undefined),
    written: ({ port }) => ({ port: Number(port), host: "localhost", path: "/" }),
  },
  async check(name, service) {
    return { name, type: "socket", ok: true, target: this.target(service), latencyMs: 1 };
  },
};
const types = () => socket;

const config = configSchemaV1.parse({ schemaVersion: 1, services: { db: { port: 5432 } } });

describe("a service type", () => {
  it("should check a service with its own type", async () => {
    const [result] = await runChecks(config, [], { timeoutMs: 100, types });

    expect(result).toMatchObject({
      name: "db",
      type: "socket",
      ok: true,
      target: "socket localhost:5432",
    });
  });

  it("should give the target of its type to a skipped service", async () => {
    const [result] = await runChecks(config, [], { timeoutMs: 100, types }, new Set(["db"]));

    expect(result).toMatchObject({
      skipped: true,
      type: "socket",
      target: "socket localhost:5432",
    });
  });

  it("should say there is nothing to open when the type has no address", async () => {
    const opened: string[] = [];
    const deps = {
      platform: platformFor("linux"),
      env: {},
      openUrl: async (url: string) => Boolean(opened.push(url)),
      copyText: async () => true,
      notify: async () => true,
      types,
    };
    const actions = serviceActions(() => config, deps);

    expect(await actions.onOpen("db")).toBe("db has no address to open");
    expect(await actions.onCopy("db", undefined)).toBe("db has no command to copy");
    expect(opened).toEqual([]);
  });

  it("should show an up service without a status by its latency", async () => {
    const results = await runChecks(config, [], { timeoutMs: 100, types });
    const history = [1];

    const lines = detailLines(results[0] as never, history, {
      unicode: false,
      width: 60,
      room: 20,
    });

    expect(lines.map(({ text }) => text)).toEqual(["up - 1ms", "1ms over 1 check"]);
    expect(
      formatCheckResults(results, { color: false, hyperlinks: false, columns: 80 } as never),
    ).toContain("socket localhost:5432  up  1ms");
  });

  it("should leave a service alone when its type takes no parameter", () => {
    const withTenant = configSchemaV1.parse({
      schemaVersion: 1,
      parameters: { tenant: { values: ["acme"], strategy: { kind: "path" } } },
      services: { db: { port: 5432, path: "/health" }, api: { port: 3000, path: "/health" } },
    });
    const bySocket = (service: Service) => (service.port === 5432 ? socket : serviceType(service));

    const { services } = applySelection(withTenant, {}, bySocket);

    expect(services.db?.path).toBe("/health");
    expect(services.api?.path).toBe("/acme/health");
  });

  describe("in the dashboard", () => {
    function open(onServiceWrite: NonNullable<EditCallbacks["onServiceWrite"]>) {
      const editing = {
        ...liveEditing(config, { onServiceWrite }),
        serviceForm: () => socket.form,
      };
      const view = initialView({ choices: {} });
      const tracker = new Tracker(["local"]);
      const edit = createEditor({
        view,
        tracker,
        editing,
        changed: () => {},
        redraw: () => {},
        declaredIn: () => [],
      });
      const actions: ViewActions = { quit() {}, refresh() {}, edit };
      const draw = () => {
        const screen = new Screen(110, 32, "truecolor");
        renderDashboard(screen, { x: 0, y: 0, w: 110, h: 32 }, tracker, view, 0);
        return screen.toPlainText();
      };
      const press = (text: string) => {
        for (const event of parseInput(text)) handleInput(event, tracker, view, actions);
      };
      draw();
      return { draw, press };
    }

    it("should ask for the fields of the type only", () => {
      const { draw, press } = open(vi.fn(async () => ({ config })));

      press("a");

      expect(draw()).toContain("add a service");
      expect(draw()).toContain("Port");
      expect(draw()).not.toMatch(/Header|Method|URL dev/);
    });

    it("should add a service with the fields of the type", async () => {
      const onServiceWrite = vi.fn<NonNullable<EditCallbacks["onServiceWrite"]>>(async () => ({
        config,
      }));
      const { press } = open(onServiceWrite);
      press("a");

      press("cache\t6379\r");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onServiceWrite.mock.lastCall?.[0]).toEqual({
        kind: "add",
        name: "cache",
        fields: { port: 6379, host: "localhost", path: "/", headers: undefined },
      });
    });
  });
});
