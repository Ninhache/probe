import { composeSource } from "./sources/compose";
import { envSource } from "./sources/env";
import { packageJsonSource } from "./sources/package-json";
import { type PortProbe, portsSource } from "./sources/ports";
import type { Source } from "./types";

/**
 * Every place probe looks at. A new one = one file in `sources/` + one entry here.
 * The order is the order of the list shown, and of trust: when two sources find the same
 * host and port, the first keeps it. Files that name their services come first, the ports
 * that merely answer come last.
 */
export function allSources(probe: PortProbe): Source[] {
  return [composeSource, envSource, packageJsonSource, portsSource(probe)];
}
