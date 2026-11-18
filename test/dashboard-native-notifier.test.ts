import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { createNotifier } from "../src/dashboard/native/open";

const GRACE = 60_000;
const result = (name: string, ok: boolean) =>
  ({ name, type: "http", ok, target: name, latencyMs: 1 }) as CheckResult;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  options: { enabled?: boolean; focused?: boolean; warning?: string; grace?: number } = {},
) {
  const told: string[] = [];
  const warnings: string[] = [];
  const state = { enabled: options.enabled ?? true, focused: options.focused, at: 0 };
  const notifier = createNotifier({
    graceMs: options.grace ?? 0,
    enabled: () => state.enabled,
    focused: () => state.focused,
    scoped: () => false,
    tell: async (message) => {
      told.push(message);
      return options.warning;
    },
    warn: (warning) => warnings.push(warning),
    now: () => state.at,
  });
  const pass = async (ok: boolean) => {
    notifier.observe("local", [result("api", ok), result("db", true)]);
    await flush();
  };
  return { told, warnings, state, notifier, pass };
}

describe("desktop notifications", () => {
  it("tells each change once, and nothing at start", async () => {
    const { told, pass } = setup();

    for (const ok of [true, true, false, false, false, true]) await pass(ok);

    expect(told).toEqual(["api is down", "api is back up"]);
  });

  it("tells nothing of a service that comes back within the grace", async () => {
    const { told, pass } = setup({ grace: GRACE });

    for (const ok of [true, false, false, true, false]) await pass(ok);

    expect(told).toEqual([]);
  });

  it("tells a service down once it has stayed down for the grace", async () => {
    const { told, pass, state } = setup({ grace: GRACE });
    await pass(true);

    await pass(false);
    state.at = GRACE - 1;
    await pass(false);
    expect(told).toEqual([]);
    state.at = GRACE;
    await pass(false);

    expect(told).toEqual(["api is down"]);
  });

  it("tells nothing while the terminal has the focus", async () => {
    const { told, pass, state } = setup({ focused: true });
    await pass(true);

    await pass(false);
    expect(told).toEqual([]);
    state.focused = false;
    await pass(true);

    expect(told).toEqual(["api is back up"]);
  });

  it("tells nothing while the option is off", async () => {
    const { told, pass } = setup({ enabled: false });

    for (const ok of [true, false, true, false]) await pass(ok);

    expect(told).toEqual([]);
  });

  it("tells nothing that happened before the option was turned on", async () => {
    const { told, pass, state } = setup({ enabled: false });
    await pass(true);
    await pass(false);

    state.enabled = true;
    await pass(false);

    expect(told).toEqual([]);
  });

  it("warns once when no notification can be shown, and keeps telling", async () => {
    const warning = "notify-send could not show a desktop notification";
    const { told, warnings, pass } = setup({ warning });

    for (const ok of [true, false, true]) await pass(ok);

    expect(told).toEqual(["api is down", "api is back up"]);
    expect(warnings).toEqual([warning]);
  });
});
