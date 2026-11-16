import type { Config } from "../config/schema";
import { ProbeError } from "../errors";

export interface Selected {
  name: string;
  skipped: boolean;
}

export function knownTags(config: Config): string[] {
  return [...new Set(Object.values(config.services).flatMap((service) => service.tags ?? []))];
}

// A service named on the command line is checked even when skipped; one that comes from a tag is not.
export function selectServices(
  config: Config,
  names: readonly string[],
  tags: readonly string[],
  skipped: ReadonlySet<string>,
): Selected[] {
  const known = Object.keys(config.services);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new ProbeError(
      "SERVICE_UNKNOWN",
      `unknown service: ${unknown.join(", ")}. Known: ${known.join(", ") || "(none)"}.`,
    );
  }
  const declared = knownTags(config);
  const undeclared = tags.filter((tag) => !declared.includes(tag));
  if (undeclared.length > 0) {
    throw new ProbeError(
      "USAGE",
      `unknown tag: ${undeclared.join(", ")}. Known: ${declared.join(", ") || "(none)"}.`,
    );
  }

  const typed = new Set(names);
  const tagged = known.filter((name) =>
    config.services[name]?.tags?.some((tag) => tags.includes(tag)),
  );
  const selected = typed.size + tags.length === 0 ? known : [...new Set([...names, ...tagged])];
  return selected.map((name) => ({ name, skipped: !typed.has(name) && skipped.has(name) }));
}
