import type { Variables } from "../config/local";
import type { Service } from "../config/schema";
import type { ResponseDetail } from "./response";

export interface CheckContext {
  timeoutMs: number;
  signal?: AbortSignal;
  detail?: boolean;
  variables?: Variables;
}

export interface CheckResult {
  name: string;
  type: string;
  /** Also true for a skipped service: it is not down. */
  ok: boolean;
  skipped?: true;
  target: string;
  status?: number;
  latencyMs: number;
  error?: string;
  hint?: string;
  /** Only when the check was asked for the detail: never in what `check --json` prints. */
  response?: ResponseDetail;
}

export interface Checker {
  type: string;
  check(name: string, service: Service, context: CheckContext): Promise<CheckResult>;
}
