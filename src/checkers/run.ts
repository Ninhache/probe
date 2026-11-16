import type { Variables } from "../config/local";
import { applySelection, type Selection } from "../config/parameters";
import type { Config, Service } from "../config/schema";
import { DEFAULT_CHECKER_TYPE } from "../constants";
import { CONFIG } from "./diagnosis";
import { targetUrl } from "./http";
import { getChecker } from "./registry";
import { selectServices } from "./select";
import type { CheckResult } from "./types";

export interface RunOptions {
  timeoutMs: number;
  forceTimeout?: boolean;
  maxTimeoutMs?: number;
  signal?: AbortSignal;
  detail?: boolean;
  variables?: Variables;
  configFile?: string;
  tags?: readonly string[];
  selection?: Selection;
}

export function resolveTimeoutMs(service: Service, options: RunOptions): number {
  const own = options.forceTimeout || service.timeout === undefined ? undefined : service.timeout;
  const wanted = own === undefined ? options.timeoutMs : Math.ceil(own * 1000);
  return Math.max(1, Math.min(wanted, options.maxTimeoutMs ?? wanted));
}

export async function runChecks(
  declared: Config,
  names: string[],
  options: RunOptions,
  skipped: ReadonlySet<string> = new Set(),
): Promise<CheckResult[]> {
  const config = applySelection(declared, options.selection);
  const selected = selectServices(config, names, options.tags ?? [], skipped);
  const results = await Promise.all(
    selected.map(({ name, skipped: skip }) => {
      const service = config.services[name] as Service;
      // Schema v1 has no `type` field; a later schema adds it.
      const type = (service as { type?: string }).type ?? DEFAULT_CHECKER_TYPE;
      if (skip) {
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
  const { configFile } = options;
  return results.map((result) => {
    const own = config.services[result.name]?.hint;
    if (own !== undefined && !result.ok) return { ...result, hint: own };
    // The hints name the file to edit: for another environment, that is not config.yml.
    if (result.hint === undefined || configFile === undefined) return result;
    return { ...result, hint: result.hint.replaceAll(CONFIG, configFile) };
  });
}
