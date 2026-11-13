import type { Service } from "../config/schema";

export interface CheckContext {
  timeoutMs: number;
  /** Cancels the checks still running, e.g. when the dashboard closes. */
  signal?: AbortSignal;
}

export interface CheckResult {
  name: string;
  type: string;
  ok: boolean;
  target: string;
  status?: number;
  latencyMs: number;
  error?: string;
}

export interface Checker {
  type: string;
  check(name: string, service: Service, context: CheckContext): Promise<CheckResult>;
}
