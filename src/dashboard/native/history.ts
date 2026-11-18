import type { CheckResult } from "../../checkers/types";

export interface Sample {
  ok: boolean;
  latencyMs: number;
  at: number;
  detail?: string;
}

export interface Transition {
  at: number;
  service: string;
  env: string;
  ok: boolean;
  detail?: string;
}

export const HISTORY_SIZE = 600;
export const EVENTS_SIZE = 200;

/** Fixed-size history: memory stays bounded however long the dashboard runs. */
export class Ring<T> {
  private readonly items: T[] = [];

  constructor(readonly capacity: number) {}

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
  readonly events = new Ring<Transition>(EVENTS_SIZE);
  private readonly series = new Map<string, Ring<Sample>>();
  private readonly known = new Set<string>();

  constructor(
    readonly environments: readonly string[],
    private readonly historySize = HISTORY_SIZE,
  ) {}

  /** Service names seen so far, in the order they first appeared, then sorted. */
  services(env?: string): string[] {
    const names = new Set<string>();
    for (const key of this.series.keys()) {
      const [at, service] = key.split("\u0000") as [string, string];
      if (env === undefined || env === at) names.add(service);
    }
    return [...names].sort();
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
      if (before ? before.ok !== result.ok : !result.ok) {
        this.events.push({ at, service: result.name, env, ok: result.ok, detail });
      }
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
