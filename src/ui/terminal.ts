export interface TerminalStream {
  isTTY?: boolean;
  columns?: number;
}

export interface Terminal {
  isTTY: boolean;
  color: boolean;
  columns: number | undefined;
  hyperlinks: boolean;
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

export function detectTerminal(stream: TerminalStream, env: NodeJS.ProcessEnv): Terminal {
  const isTTY = Boolean(stream.isTTY);
  const capable = isTTY && env.TERM !== "dumb";
  const columns = isTTY && stream.columns && stream.columns > 0 ? stream.columns : undefined;
  return {
    isTTY,
    color: capable && !env.NO_COLOR,
    columns,
    hyperlinks: capable && supportsHyperlinks(env),
    unicode: capable && supportsUnicode(env),
  };
}

export function isInteractive(
  stdin: TerminalStream,
  stdout: TerminalStream,
  env: NodeJS.ProcessEnv,
): boolean {
  return Boolean(stdin.isTTY) && Boolean(stdout.isTTY) && env.TERM !== "dumb" && !env.CI;
}

const ELLIPSIS = "…";

// Counts code points: a double-width character (CJK, emoji) still takes two columns on screen.
export function truncate(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return max <= 1 ? ELLIPSIS : `${characters.slice(0, max - 1).join("")}${ELLIPSIS}`;
}

const SGR_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripStyles(text: string): string {
  return text.replace(SGR_PATTERN, "");
}
