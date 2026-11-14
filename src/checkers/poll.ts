import { setTimeout as delay } from "node:timers/promises";
import { WAIT_BACKOFF_FACTOR, WAIT_LAST_PASS_MS } from "../constants";
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
 * `check` receives the time allowed for the pass and what is left before the deadline.
 * The first pass starts at once. When the next pause would cross the deadline, one last pass runs
 * shortly before it instead, and its results are the ones returned.
 * An error thrown by `check` is not retried.
 */
export async function pollUntilUp(
  check: (timeoutMs: number, remainingMs: number) => Promise<CheckResult[]>,
  options: PollOptions,
): Promise<PollOutcome> {
  const { deadlineMs, attemptTimeoutMs, maxIntervalMs, onPass } = options;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? delay;
  const started = now();
  const remaining = () => deadlineMs - (now() - started);
  let pause = Math.min(options.intervalMs, maxIntervalMs);
  let lastPass = false;

  while (true) {
    // A late timer can leave a fraction of a millisecond: still a whole, positive delay for the pass.
    const left = Math.max(1, Math.ceil(remaining()));
    const results = await check(Math.min(attemptTimeoutMs, left), left);
    const elapsedMs = Math.round(now() - started);
    onPass?.(results, elapsedMs);
    if (results.every((result) => result.ok)) return { results, elapsedMs, timedOut: false };

    const rest = remaining();
    if (lastPass || rest <= 0) return { results, elapsedMs, timedOut: true };
    if (pause >= rest) {
      lastPass = true;
      await sleep(rest - Math.min(WAIT_LAST_PASS_MS, rest / 2));
    } else {
      await sleep(pause);
      pause = Math.min(pause * WAIT_BACKOFF_FACTOR, maxIntervalMs);
    }
  }
}
