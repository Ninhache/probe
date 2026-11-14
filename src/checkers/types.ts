import type { Service } from "../config/schema";

export interface CheckContext {
  timeoutMs: number;
  /** Cancels the checks still running, e.g. when the dashboard closes. */
  signal?: AbortSignal;
}

export interface CheckResult {
  name: string;
  type: string;
  /** Also true for a skipped service: it is not down. */
  ok: boolean;
  /** Set aside in `local.yml`: not checked. */
  skipped?: true;
  target: string;
  status?: number;
  latencyMs: number;
  error?: string;
}

export interface Checker {
  type: string;
  check(name: string, service: Service, context: CheckContext): Promise<CheckResult>;
}
