import type { Variables } from "../config/local";
import type { Config, Service } from "../config/schema";
import { DEFAULT_CHECKER_TYPE } from "../constants";
import { ProbeError } from "../errors";
import { targetUrl } from "./http";
import { getChecker } from "./registry";
import type { CheckResult } from "./types";

export interface RunOptions {
  timeoutMs: number;
  forceTimeout?: boolean;
  maxTimeoutMs?: number;
  signal?: AbortSignal;
  detail?: boolean;
  variables?: Variables;
}

export function resolveTimeoutMs(service: Service, options: RunOptions): number {
  const own = options.forceTimeout || service.timeout === undefined ? undefined : service.timeout;
  const wanted = own === undefined ? options.timeoutMs : Math.ceil(own * 1000);
  return Math.max(1, Math.min(wanted, options.maxTimeoutMs ?? wanted));
}

export async function runChecks(
  config: Config,
  names: string[],
  options: RunOptions,
  skipped: ReadonlySet<string> = new Set(),
): Promise<CheckResult[]> {
  const known = Object.keys(config.services);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new ProbeError(
      "SERVICE_UNKNOWN",
      `unknown service: ${unknown.join(", ")}. Known: ${known.join(", ") || "(none)"}.`,
    );
  }

  const selected = names.length > 0 ? [...new Set(names)] : known;
  return Promise.all(
    selected.map((name) => {
      const service = config.services[name] as Service;
      // Schema v1 has no `type` field; a later schema adds it.
      const type = (service as { type?: string }).type ?? DEFAULT_CHECKER_TYPE;
      if (names.length === 0 && skipped.has(name)) {
        const result: CheckResult = {
          name,
          type,
          ok: true,
          skipped: true,
          target: targetUrl(service),
          latencyMs: 0,
        };
        return result;
      }
      return getChecker(type).check(name, service, {
        timeoutMs: resolveTimeoutMs(service, options),
        signal: options.signal,
        detail: options.detail,
        variables: options.variables,
      });
    }),
  );
}
