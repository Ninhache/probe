import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { changeMessage, stateChanges } from "../src/dashboard/changes";

const result = (name: string, ok: boolean, over: Partial<CheckResult> = {}): CheckResult => ({
  name,
  type: "http",
  ok,
  target: `http://localhost/${name}`,
  latencyMs: 1,
  ...over,
});

describe("stateChanges", () => {
  it("should report nothing on the first pass", () => {
    const { known, changes } = stateChanges(new Map(), [result("api", true), result("db", false)]);

    expect(changes).toEqual([]);
    expect([...known]).toEqual([
      ["api", true],
      ["db", false],
    ]);
  });

  it("should report a service that went down and one that came back", () => {
    const known = new Map([
      ["api", true],
      ["db", false],
      ["web", true],
    ]);

    const { changes } = stateChanges(known, [
      result("api", false),
      result("db", true),
      result("web", true),
    ]);

    expect(changes).toEqual([
      { name: "api", up: false },
      { name: "db", up: true },
    ]);
  });

  it("should not report a service that stays down for another reason", () => {
    const known = new Map([["api", false]]);

    expect(stateChanges(known, [result("api", false, { error: "timeout" })]).changes).toEqual([]);
  });

  it("should not report a service that was just added", () => {
    const known = new Map([["api", true]]);

    expect(stateChanges(known, [result("api", true), result("new", false)]).changes).toEqual([]);
  });

  it("should forget a skipped service, so that it comes back without a report", () => {
    const skipped = result("api", true, { skipped: true });

    const during = stateChanges(new Map([["api", false]]), [skipped]);
    const after = stateChanges(during.known, [result("api", true)]);

    expect(during.changes).toEqual([]);
    expect(during.known.has("api")).toBe(false);
    expect(after.changes).toEqual([]);
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
