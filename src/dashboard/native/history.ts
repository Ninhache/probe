import type { CheckResult } from "../../checkers/types";
import {
  LOCAL_ENVIRONMENT,
  LOG_PREVIEW_CHARS,
  LOG_PREVIEW_SCAN_CHARS,
  LOG_SIZE,
} from "../../constants";

export { LOCAL_ENVIRONMENT };

export interface Sample {
  ok: boolean;
  latencyMs: number;
  at: number;
  detail?: string;
}

/** One check result as a line of the log tab. */
export interface LogEntry {
  at: number;
  service: string;
  env: string;
  ok: boolean;
  /** The status code, or the error of a failure. */
  detail?: string;
  /** The body on one line, cut: built once, when the result is recorded. */
  preview: string;
  /** The service went up or down with this result. */
  change: boolean;
}

/** The body of a result as one line. The body was masked when it was checked, so no secret is in it. */
export function bodyPreview(body: string | undefined): string {
  if (!body) return "";
  return body
    .slice(0, LOG_PREVIEW_SCAN_CHARS)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LOG_PREVIEW_CHARS);
}

export const HISTORY_SIZE = 600;

/** Fixed-size history: memory stays bounded however long the dashboard runs. */
export class Ring<T> {
  private readonly items: T[] = [];

  constructor(readonly capacity: number) {}

  clear(): void {
    this.items.length = 0;
  }

  push(value: T): void {
    this.items.push(value);
    if (this.items.length > this.capacity) this.items.shift();
  }

  get last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  toArray(): readonly T[] {
    return this.items;
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

export interface SeriesStats {
  /** Share of the remembered checks that passed, 0..1; 0 while nothing was checked. */
  uptime: number;
  p50: number;
  p95: number;
  checks: number;
  last?: Sample;
}

export function statsOf(series: readonly Ring<Sample>[]): SeriesStats {
  const samples = series.flatMap((ring) => ring.toArray());
  const latencies = samples.map((sample) => sample.latencyMs);
  const last = series
    .map((ring) => ring.last)
    .reduce<Sample | undefined>(
      (best, sample) => (!best || (sample && sample.at > best.at) ? sample : best),
      undefined,
    );
  return {
    uptime: samples.length ? samples.filter((sample) => sample.ok).length / samples.length : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    checks: samples.length,
    last,
  };
}

const keyOf = (service: string, env: string) => `${env}\u0000${service}`;

/** What the dashboard remembers: a bounded history per service and environment, and the up/down transitions. */
export class Tracker {
  readonly log = new Ring<LogEntry>(LOG_SIZE);
  /** The log lines where a service changed state, kept apart so filtering to them costs nothing per draw. */
  readonly changes = new Ring<LogEntry>(LOG_SIZE);
  private readonly series = new Map<string, Ring<Sample>>();
  private readonly known = new Set<string>();
  private readonly results = new Map<string, CheckResult>();

  /** The tabs, in order; `add` appends one while the dashboard runs. */
  readonly environments: string[];

  constructor(
    environments: readonly string[],
    private readonly historySize = HISTORY_SIZE,
  ) {
    this.environments = [...environments];
  }

  add(env: string): void {
    if (!this.environments.includes(env)) this.environments.push(env);
  }

  /** Forgets an environment: its tab, and what was measured in it. */
  remove(env: string): void {
    const at = this.environments.indexOf(env);
    if (at >= 0) this.environments.splice(at, 1);
    this.retain(env, new Set());
  }

  /** Service names seen so far, in the order they first appeared, then sorted. */
  services(env?: string): string[] {
    const names = new Set<string>();
    for (const key of [...this.series.keys(), ...this.known]) {
      const [at, service] = key.split("\u0000") as [string, string];
      if (env === undefined || env === at) names.add(service);
    }
    return [...names].sort();
  }

  /** The last full result (request, response...) of a service in an environment. */
  result(service: string, env: string): CheckResult | undefined {
    return this.results.get(keyOf(service, env));
  }

  /**
   * Forget the measures: another parameter value is another target. The service names stay so the list
   * does not empty until the next pass, and the log stays because it is what was answered so far.
   */
  reset(): void {
    for (const key of this.series.keys()) this.known.add(key);
    this.series.clear();
    this.results.clear();
  }

  /** Forget the services of an environment that are not in `names` any more: removed or undone. */
  retain(env: string, names: ReadonlySet<string>): void {
    const gone = (key: string) => {
      const [at, service] = key.split("\u0000") as [string, string];
      return at === env && !names.has(service);
    };
    for (const key of [...this.series.keys()].filter(gone)) this.series.delete(key);
    for (const key of [...this.known].filter(gone)) this.known.delete(key);
    for (const key of [...this.results.keys()].filter(gone)) this.results.delete(key);
  }

  history(service: string, env: string): Ring<Sample> | undefined {
    return this.series.get(keyOf(service, env));
  }

  /** The rings of a service in one environment, or in all of them. */
  rings(service: string, env?: string): Ring<Sample>[] {
    return this.environments
      .filter((name) => env === undefined || name === env)
      .flatMap((name) => this.history(service, name) ?? []);
  }

  record(env: string, results: readonly CheckResult[], at = Date.now()): void {
    for (const result of results) {
      const key = keyOf(result.name, env);
      this.results.set(key, result);
      if (result.skipped) {
        this.known.add(key);
        continue;
      }
      let ring = this.series.get(key);
      if (!ring) {
        ring = new Ring<Sample>(this.historySize);
        this.series.set(key, ring);
      }
      const before = ring.last;
      const detail = result.ok
        ? undefined
        : (result.error ?? (result.status ? String(result.status) : undefined));
      ring.push({ ok: result.ok, latencyMs: result.latencyMs, at, detail });
      const change = before ? before.ok !== result.ok : !result.ok;
      const entry: LogEntry = {
        at,
        service: result.name,
        env,
        ok: result.ok,
        // The code alone leaves room for the body; the error is only for a check with no answer.
        detail: result.status ? String(result.status) : detail,
        preview: bodyPreview(result.response?.body),
        change,
      };
      this.log.push(entry);
      if (change) this.changes.push(entry);
    }
  }

  /** An environment that could not be checked at all (unreadable file, ...): every service of it is down. */
  recordFailure(env: string, message: string, at = Date.now()): void {
    const names = this.services(env);
    this.record(
      env,
      names.map((name) => ({
        name,
        type: "",
        ok: false,
        target: "",
        latencyMs: 0,
        error: message,
      })),
      at,
    );
  }
}
