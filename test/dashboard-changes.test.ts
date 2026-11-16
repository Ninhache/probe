import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { changeMessage, type KnownStates, stateChanges } from "../src/dashboard/changes";

const result = (name: string, ok: boolean, over: Partial<CheckResult> = {}): CheckResult => ({
  name,
  type: "http",
  ok,
  target: `http://localhost/${name}`,
  latencyMs: 1,
  ...over,
});

const GRACE = 60_000;
const passes = (steps: [at: number, results: CheckResult[]][], graceMs = GRACE) => {
  let known: KnownStates = new Map();
  return steps.map(([at, results]) => {
    const pass = stateChanges(known, results, at, graceMs);
    known = pass.known;
    return pass.changes;
  });
};

describe("stateChanges", () => {
  it("should report nothing on the first pass", () => {
    expect(passes([[0, [result("api", true), result("db", false)]]])).toEqual([[]]);
  });

  it("should report a service down once it has stayed down for the grace", () => {
    expect(
      passes([
        [0, [result("api", true)]],
        [1_000, [result("api", false)]],
        [60_000, [result("api", false)]],
        [61_000, [result("api", false)]],
        [120_000, [result("api", false, { error: "timeout" })]],
      ]),
    ).toEqual([[], [], [], [{ name: "api", up: false }], []]);
  });

  it("should say nothing of a service that comes back within the grace", () => {
    expect(
      passes([
        [0, [result("api", true)]],
        [1_000, [result("api", false)]],
        [31_000, [result("api", true)]],
        [32_000, [result("api", false)]],
        [91_000, [result("api", false)]],
      ]),
    ).toEqual([[], [], [], [], []]);
  });

  it("should report a service back up only after it was reported down", () => {
    expect(
      passes([
        [0, [result("api", true)]],
        [1_000, [result("api", false)]],
        [61_000, [result("api", false)]],
        [62_000, [result("api", true)]],
        [63_000, [result("api", true)]],
      ]),
    ).toEqual([[], [], [{ name: "api", up: false }], [{ name: "api", up: true }], []]);
  });

  it("should report at once without a grace", () => {
    expect(
      passes(
        [
          [0, [result("api", true)]],
          [1, [result("api", false)]],
          [2, [result("api", true)]],
        ],
        0,
      ),
    ).toEqual([[], [{ name: "api", up: false }], [{ name: "api", up: true }]]);
  });

  it("should report the return of a service found down at start or just added", () => {
    expect(
      passes([
        [0, [result("api", false)]],
        [1_000, [result("api", true), result("new", false)]],
        [2_000, [result("api", true), result("new", true)]],
      ]),
    ).toEqual([[], [{ name: "api", up: true }], [{ name: "new", up: true }]]);
  });

  it("should forget a skipped service, so that it comes back without a report", () => {
    const skipped = result("api", true, { skipped: true });

    expect(
      passes(
        [
          [0, [result("api", true)]],
          [1, [result("api", false)]],
          [2, [skipped]],
          [3, [result("api", true)]],
        ],
        0,
      ),
    ).toEqual([[], [{ name: "api", up: false }], [], []]);
  });
});

describe("changeMessage", () => {
  it("should say which way a single service went", () => {
    expect(changeMessage([{ name: "api", up: false }])).toBe("api is down");
    expect(changeMessage([{ name: "api", up: true }])).toBe("api is back up");
  });

  it("should group several services, the ones down first", () => {
    expect(
      changeMessage([
        { name: "api", up: true },
        { name: "db", up: false },
        { name: "web", up: false },
      ]),
    ).toBe("down: db, web; back up: api");
    expect(
      changeMessage([
        { name: "api", up: false },
        { name: "db", up: false },
      ]),
    ).toBe("down: api, db");
  });
});
