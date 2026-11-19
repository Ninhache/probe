import type { CheckResult } from "../../checkers/types";

export interface EnvironmentCheck {
  name: string;
  run(signal: AbortSignal): Promise<CheckResult[]>;
}

export interface MonitorOptions {
  intervalMs: number;
  onResults: (env: string, results: CheckResult[]) => void;
  onFailure: (env: string, message: string) => void;
}

/** Runs every environment on its own timer. It updates state through the callbacks and never draws. */
export class Monitor {
  private readonly shutdown = new AbortController();
  private readonly inflight = new Set<string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private generation = 0;

  constructor(
    private readonly checks: EnvironmentCheck[],
    private readonly options: MonitorOptions,
  ) {}

  start(): void {
    for (const check of this.checks) {
      void this.run(check);
      this.schedule(check, this.options.intervalMs);
    }
  }

  private schedule(check: EnvironmentCheck, intervalMs: number): void {
    this.timers.set(
      check.name,
      setInterval(() => void this.run(check), intervalMs),
    );
  }

  /** Stops checking an environment whose file is gone; what it measured is the tracker's to drop. */
  remove(name: string): void {
    clearInterval(this.timers.get(name));
    this.timers.delete(name);
    const at = this.checks.findIndex((check) => check.name === name);
    if (at >= 0) this.checks.splice(at, 1);
  }

  /** Starts checking one more environment now, at the pace of the others. */
  add(check: EnvironmentCheck): void {
    this.checks.push(check);
    void this.run(check);
    this.schedule(check, this.options.intervalMs);
  }

  /** Same checks, another pace. */
  setInterval(intervalMs: number): void {
    this.options.intervalMs = intervalMs;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    for (const check of this.checks) this.schedule(check, intervalMs);
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.shutdown.abort();
  }

  /**
   * What a pass is run with changed (the selection, the config): the passes under way are
   * dropped when they end, and run again at once.
   */
  invalidate(): void {
    this.generation += 1;
  }

  /** Checks every environment now; one already running is not started twice. */
  refresh(): void {
    for (const check of this.checks) void this.run(check);
  }

  async run(check: EnvironmentCheck): Promise<void> {
    if (this.inflight.has(check.name) || this.shutdown.signal.aborted) return;
    this.inflight.add(check.name);
    const started = this.generation;
    const stale = () => started !== this.generation;
    try {
      const results = await check.run(this.shutdown.signal);
      if (!this.shutdown.signal.aborted && !stale()) this.options.onResults(check.name, results);
    } catch (error) {
      if (!this.shutdown.signal.aborted && !stale())
        this.options.onFailure(check.name, error instanceof Error ? error.message : String(error));
    } finally {
      this.inflight.delete(check.name);
      if (stale()) void this.run(check);
    }
  }
}
