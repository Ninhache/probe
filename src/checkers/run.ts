import type { Config } from "../config/schema";
import { DEFAULT_CHECKER_TYPE } from "../constants";
import { ProbeError } from "../errors";
import { getChecker } from "./registry";
import type { CheckContext, CheckResult } from "./types";

/** Runs the named services' checks in parallel; all services when `names` is empty. */
export async function runChecks(
  config: Config,
  names: string[],
  context: CheckContext,
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
      return getChecker(type).check(name, service, context);
    }),
  );
}
