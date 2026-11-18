import { describe, expect, it } from "vitest";
import { secondsToMs } from "../src/commands/shared";
import { ProbeError } from "../src/errors";

describe("secondsToMs", () => {
  it("should round a fractional number of seconds up to the next millisecond", () => {
    expect(secondsToMs("--timeout", "0.1234")).toBe(124);
  });

  it("should refuse zero", () => {
    expect(() => secondsToMs("--timeout", "0")).toThrow(ProbeError);
  });
});
