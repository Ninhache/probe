import { supportsUnicode } from "./terminal";

/** The few symbols the command output draws, so that one switch decides between Unicode and ASCII. */
export interface Glyphs {
  /** Marks of a check line; all of the same width so that the table stays aligned. */
  ok: string;
  fail: string;
  skipped: string;
  /** Between the parts of a title. */
  dot: string;
  /** Between a state and what to do about it. */
  arrow: string;
}

export const UNICODE_GLYPHS: Glyphs = { ok: "✓", fail: "✗", skipped: "-", dot: "·", arrow: "→" };
export const ASCII_GLYPHS: Glyphs = { ok: "ok", fail: "x ", skipped: "- ", dot: "-", arrow: "->" };

/** The glyphs for `env`: ASCII when the locale is not UTF-8, on a Linux console, or with PROBE_ASCII=1. */
export const glyphsFor = (env: NodeJS.ProcessEnv): Glyphs =>
  supportsUnicode(env) ? UNICODE_GLYPHS : ASCII_GLYPHS;
