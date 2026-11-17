import { describe, expect, it } from "vitest";
import { runChecks } from "../src/checkers/run";
import type { ServiceType } from "../src/checkers/types";
import { configSchemaV1, type Service } from "../src/config/schema";
import { serviceActions } from "../src/dashboard/actions";
import { detailLines, recordLatencies } from "../src/dashboard/detail";
import { formatCheckResults } from "../src/ui/report";

// A type with no URL, no headers and no command: what the dashboard and `check` know must come from it.
const socket: ServiceType = {
  type: "socket",
  target: (service: Service) => `socket ${service.host}:${service.port}`,
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
      platform: "linux" as const,
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
    const history = recordLatencies({}, results).db ?? [];

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
});
