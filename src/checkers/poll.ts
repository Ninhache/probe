import { setTimeout as delay } from "node:timers/promises";
import { WAIT_BACKOFF_FACTOR } from "../constants";
import type { CheckResult } from "./types";

export interface PollOptions {
  /** Total time allowed, all passes and pauses included. */
  deadlineMs: number;
  /** Time allowed for one pass; shortened when less than that is left. */
  attemptTimeoutMs: number;
  /** Pause after the first pass; it grows after each pass, up to `maxIntervalMs`. */
  intervalMs: number;
  maxIntervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  onPass?: (results: CheckResult[], elapsedMs: number) => void;
}

export interface PollOutcome {
  results: CheckResult[];
  elapsedMs: number;
  timedOut: boolean;
}

/**
 * Runs `check` until every result of one pass is ok, or until the deadline.
 * The first pass starts at once; no pass starts once the deadline is reached.
 * An error thrown by `check` is not retried.
 */
export async function pollUntilUp(
  check: (timeoutMs: number) => Promise<CheckResult[]>,
  options: PollOptions,
): Promise<PollOutcome> {
  const { deadlineMs, attemptTimeoutMs, maxIntervalMs, onPass } = options;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? delay;
  const started = now();
  const remaining = () => deadlineMs - (now() - started);
  let pause = Math.min(options.intervalMs, maxIntervalMs);

  while (true) {
    // A late timer can leave a fraction of a millisecond: still a whole, positive delay for the pass.
    const results = await check(Math.max(1, Math.ceil(Math.min(attemptTimeoutMs, remaining()))));
    const elapsedMs = Math.round(now() - started);
    onPass?.(results, elapsedMs);
    if (results.every((result) => result.ok)) return { results, elapsedMs, timedOut: false };

    const left = remaining();
    if (left <= 0) return { results, elapsedMs, timedOut: true };
    if (pause >= left) {
      // No time for another pass after this pause: wait out the deadline, keep the last real results.
      await sleep(left);
      return { results, elapsedMs: Math.round(now() - started), timedOut: true };
    }
    await sleep(pause);
    pause = Math.min(pause * WAIT_BACKOFF_FACTOR, maxIntervalMs);
  }
}
