import type { Config } from "../config/schema";
import { DEFAULT_CHECKER_TYPE } from "../constants";
import { ProbeError } from "../errors";
import { targetUrl } from "./http";
import { getChecker } from "./registry";
import type { CheckContext, CheckResult } from "./types";

/**
 * Runs the named services' checks in parallel; all services when `names` is empty.
 * A service in `skipped` is reported without being checked, unless it is named.
 */
export async function runChecks(
  config: Config,
  names: string[],
  context: CheckContext,
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
      const service = config.services[name] as Config["services"][string];
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
      return getChecker(type).check(name, service, context);
    }),
  );
}
