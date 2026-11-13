declare const __PROBE_VERSION__: string | undefined;

// Replaced at build time by tsup; undefined when running from source (tests).
export const CLI_VERSION = typeof __PROBE_VERSION__ === "string" ? __PROBE_VERSION__ : "0.0.0-dev";
