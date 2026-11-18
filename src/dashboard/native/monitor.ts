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
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly checks: readonly EnvironmentCheck[],
    private readonly options: MonitorOptions,
  ) {}

  start(): void {
    for (const check of this.checks) {
      void this.run(check);
      this.timers.push(setInterval(() => void this.run(check), this.options.intervalMs));
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.shutdown.abort();
  }

  /** Checks every environment now; one already running is not started twice. */
  refresh(): void {
    for (const check of this.checks) void this.run(check);
  }

  async run(check: EnvironmentCheck): Promise<void> {
    if (this.inflight.has(check.name) || this.shutdown.signal.aborted) return;
    this.inflight.add(check.name);
    try {
      const results = await check.run(this.shutdown.signal);
      if (!this.shutdown.signal.aborted) this.options.onResults(check.name, results);
    } catch (error) {
      if (!this.shutdown.signal.aborted)
        this.options.onFailure(check.name, error instanceof Error ? error.message : String(error));
    } finally {
      this.inflight.delete(check.name);
    }
  }
}
