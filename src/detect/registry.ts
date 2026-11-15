import { composeSource } from "./sources/compose";
import { envSource } from "./sources/env";
import { packageJsonSource } from "./sources/package-json";
import { portsSource } from "./sources/ports";
import type { Source } from "./types";

// The order is that of the list shown, and of trust: when two sources find the same host and port, the first keeps it.
export const SOURCES: readonly Source[] = [
  composeSource,
  envSource,
  packageJsonSource,
  portsSource,
];
