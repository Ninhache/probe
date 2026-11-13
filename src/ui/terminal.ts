import { NARROW_COLUMNS } from "../constants";

export interface TerminalStream {
  isTTY?: boolean;
  columns?: number;
}

/** What one output stream can show. Every way of degrading the display is decided here. */
export interface Terminal {
  isTTY: boolean;
  /** SGR colours and styles may be written. */
  color: boolean;
  /** Width in columns; undefined when unknown (not a terminal), in which case nothing is cut. */
  columns: number | undefined;
  /** Known width under NARROW_COLUMNS: renderers switch to their compact layout. */
  narrow: boolean;
  /** OSC 8 hyperlinks are known to be rendered, not printed as garbage. */
  hyperlinks: boolean;
  /** Characters outside ASCII (box drawing, arrows) can be drawn. */
  unicode: boolean;
}

function version(text: string | undefined): [number, number] {
  const [major, minor] = (text ?? "").split(".").map((part) => Number.parseInt(part, 10));
  return [major || 0, minor || 0];
}

// Allow-list taken from chalk/supports-hyperlinks. Unknown terminals get no link:
// a terminal that ignores OSC 8 may print the sequence as text.
function supportsHyperlinks(env: NodeJS.ProcessEnv): boolean {
  if (env.TMUX || /^(screen|tmux)/.test(env.TERM ?? "")) return false;
  const [major, minor] = version(env.TERM_PROGRAM_VERSION);
  switch (env.TERM_PROGRAM) {
    case "iTerm.app":
      return major > 3 || (major === 3 && minor >= 1);
    case "vscode":
      return major > 1 || (major === 1 && minor >= 72);
    case "WezTerm":
    case "ghostty":
    case "WarpTerminal":
    case "zed":
      return true;
  }
  // VTE (GNOME Terminal, Tilix…) writes its version as digits: 0.50.1 is "5001".
  if (/^\d{4,}$/.test(env.VTE_VERSION ?? "")) return Number(env.VTE_VERSION) >= 5001;
  return env.TERM === "alacritty" || env.TERM === "xterm-kitty";
}

function supportsUnicode(env: NodeJS.ProcessEnv): boolean {
  if (env.TERM === "linux") return false;
  return /UTF-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || "");
}

/**
 * Describes what `stream` can display.
 * @param stream the output stream the text goes to (stdout and stderr are detected separately)
 * @param env the process environment (`NO_COLOR`, `TERM`, `TERM_PROGRAM`, locale)
 * @returns the capabilities; off a terminal everything is off and the width is unknown
 */
export function detectTerminal(stream: TerminalStream, env: NodeJS.ProcessEnv): Terminal {
  const isTTY = Boolean(stream.isTTY);
  const capable = isTTY && env.TERM !== "dumb";
  const columns = isTTY && stream.columns && stream.columns > 0 ? stream.columns : undefined;
  return {
    isTTY,
    color: capable && !env.NO_COLOR,
    columns,
    narrow: columns !== undefined && columns < NARROW_COLUMNS,
    hyperlinks: capable && supportsHyperlinks(env),
    unicode: capable && supportsUnicode(env),
  };
}

/**
 * Tells whether probe may ask questions or take over the screen.
 * @returns true only when both ends are a real terminal, outside CI
 */
export function isInteractive(
  stdin: TerminalStream,
  stdout: TerminalStream,
  env: NodeJS.ProcessEnv,
): boolean {
  return Boolean(stdin.isTTY) && Boolean(stdout.isTTY) && env.TERM !== "dumb" && !env.CI;
}

const ELLIPSIS = "…";

/** Cuts plain text (no escape sequence) to `max` columns, ending with an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return max <= 1 ? ELLIPSIS : `${text.slice(0, max - 1)}${ELLIPSIS}`;
}

const SGR_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Removes colour and style sequences, for text styled by a library that ignores the stream. */
export function stripStyles(text: string): string {
  return text.replace(SGR_PATTERN, "");
}
