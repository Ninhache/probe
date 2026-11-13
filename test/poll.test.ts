import { describe, expect, it } from "vitest";
import { pollUntilUp } from "../src/checkers/poll";
import type { CheckResult } from "../src/checkers/types";
import { progressReporter } from "../src/commands/wait";

const result = (name: string, ok: boolean): CheckResult => ({
  name,
  type: "http",
  ok,
  target: `http://localhost/${name}`,
  latencyMs: 1,
});

/** A clock that only moves when the loop sleeps or when a pass takes time. */
function fakeTime(passMs = 0) {
  let time = 0;
  const sleeps: number[] = [];
  const timeouts: number[] = [];
  return {
    sleeps,
    timeouts,
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    pass: (timeoutMs: number) => {
      timeouts.push(timeoutMs);
      time += passMs;
    },
  };
}

const base = { attemptTimeoutMs: 3_000, intervalMs: 500, maxIntervalMs: 5_000 };

describe("pollUntilUp", () => {
  it("returns after the first pass, without sleeping, when everything is up", async () => {
    const time = fakeTime();
    const outcome = await pollUntilUp(
      async (timeoutMs) => {
        time.pass(timeoutMs);
        return [result("api", true)];
      },
      { ...base, deadlineMs: 60_000, now: time.now, sleep: time.sleep },
    );

    expect(outcome).toMatchObject({ timedOut: false, elapsedMs: 0 });
    expect(time.sleeps).toEqual([]);
  });

  it("returns at once when there is nothing to check", async () => {
    const time = fakeTime();
    const outcome = await pollUntilUp(async () => [], {
      ...base,
      deadlineMs: 60_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(outcome).toMatchObject({ results: [], timedOut: false });
  });

  it("doubles the pause up to the cap, then stops as soon as a pass is all up", async () => {
    const time = fakeTime();
    let passes = 0;
    const outcome = await pollUntilUp(
      async (timeoutMs) => {
        time.pass(timeoutMs);
        passes += 1;
        return [result("api", true), result("db", passes >= 7)];
      },
      { ...base, deadlineMs: 60_000, now: time.now, sleep: time.sleep },
    );

    expect(time.sleeps).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
    expect(outcome).toMatchObject({ timedOut: false, elapsedMs: 17_500 });
  });

  it("gives up at the deadline, with the pause and the last pass cut to the time left", async () => {
    const time = fakeTime(200);
    const outcome = await pollUntilUp(
      async (timeoutMs) => {
        time.pass(timeoutMs);
        return [result("api", false)];
      },
      { ...base, deadlineMs: 2_000, now: time.now, sleep: time.sleep },
    );

    expect(time.sleeps).toEqual([500, 1_000]);
    expect(time.timeouts).toEqual([2_000, 1_300, 100]);
    expect(outcome.timedOut).toBe(true);
    expect(outcome.results).toEqual([result("api", false)]);
  });

  it("starts no pass once the deadline is reached", async () => {
    const time = fakeTime();
    let passes = 0;
    const outcome = await pollUntilUp(
      async () => {
        passes += 1;
        return [result("api", false)];
      },
      { ...base, deadlineMs: 1_000, now: time.now, sleep: time.sleep },
    );

    expect(time.sleeps).toEqual([500, 500]);
    expect(passes).toBe(2);
    expect(outcome.timedOut).toBe(true);
  });

  it("does not retry when the check throws", async () => {
    const time = fakeTime();
    let passes = 0;
    const failing = pollUntilUp(
      async () => {
        passes += 1;
        throw new Error("unknown service");
      },
      { ...base, deadlineMs: 60_000, now: time.now, sleep: time.sleep },
    );

    await expect(failing).rejects.toThrow("unknown service");
    expect(passes).toBe(1);
  });
});

describe("progressReporter", () => {
  it("names what is down first, then only what changes", () => {
    const report = progressReporter();

    expect(report([result("api", true), result("db", false)], 10)).toEqual(["waiting for db"]);
    expect(report([result("api", true), result("db", false)], 500)).toEqual([]);
    expect(report([result("api", false), result("db", true)], 4_230)).toEqual([
      "api down again",
      "db up after 4.2s",
    ]);
  });

  it("says nothing when everything is up at once", () => {
    expect(progressReporter()([result("api", true)], 5)).toEqual([]);
  });
});
