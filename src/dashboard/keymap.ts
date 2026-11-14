/** Where the keys go: the list, a panel open under it, or the help. */
export type Screen = "list" | "panel" | "help";

interface Binding {
  screens: readonly Screen[];
  keys: string;
  /** How to write the keys on a terminal without unicode. */
  ascii?: string;
  /** One word, for the bar. */
  action: string;
  /** One line, for the help. */
  help: string;
  /** Rank at which the bar gives it up when it is too wide, lowest first; unset: always shown. */
  drop?: number;
}

/**
 * Every key of the dashboard. The bar and the help are drawn from this table, in this order:
 * a new key is one entry here and one branch where keys are handled.
 */
const BINDINGS: readonly Binding[] = [
  { screens: ["list"], keys: "↑↓ jk", ascii: "jk", action: "move", help: "Move", drop: 1 },
  { screens: ["list"], keys: "r", action: "check", help: "Check now", drop: 2 },
  {
    screens: ["list"],
    keys: "↵",
    ascii: "enter",
    action: "service",
    help: "Settings of the selected service",
    drop: 5,
  },
  {
    screens: ["list"],
    keys: "u",
    action: "open",
    help: "Open its URL in the browser",
    drop: 4,
  },
  {
    screens: ["list"],
    keys: "c",
    action: "copy",
    help: "Copy its curl command",
    drop: 3,
  },
  {
    screens: ["list"],
    keys: "o",
    action: "options",
    help: "Options: interval and timeout",
    drop: 6,
  },
  { screens: ["panel"], keys: "↑↓ jk", ascii: "jk", action: "move", help: "Move", drop: 1 },
  {
    screens: ["panel"],
    keys: "←→ hl",
    ascii: "hl",
    action: "change",
    help: "Change the value",
    drop: 2,
  },
  {
    screens: ["panel"],
    keys: "esc",
    action: "close",
    help: "Close (so does the key that opened it)",
  },
  { screens: ["help"], keys: "? esc", action: "close", help: "Close" },
  { screens: ["list", "panel"], keys: "?", action: "help", help: "This help" },
  { screens: ["list", "panel", "help"], keys: "q", action: "quit", help: "Quit" },
];

const SECTIONS: readonly [title: string, has: (binding: Binding) => boolean][] = [
  ["List", ({ screens }) => screens.length === 1 && screens[0] === "list"],
  ["Panels", ({ screens }) => screens.length === 1 && screens[0] === "panel"],
  ["Everywhere", ({ screens }) => screens.length > 1],
];

const written = (binding: Binding, unicode: boolean) =>
  unicode ? binding.keys : (binding.ascii ?? binding.keys);

/**
 * The keys of a screen on one line. Too wide for `columns`, it gives up the keys one guesses
 * (moving first) and keeps those that lead out: help, close, quit.
 */
export function helpBar(screen: Screen, unicode: boolean, columns: number): string {
  const shown = BINDINGS.filter(({ screens }) => screens.includes(screen));
  const line = () =>
    shown
      .map((binding) => `${written(binding, unicode)} ${binding.action}`)
      .join(unicode ? " · " : " - ");
  while (line().length > columns) {
    const droppable = shown.filter(({ drop }) => drop !== undefined);
    if (droppable.length === 0) break;
    const first = droppable.reduce((a, b) => ((a.drop as number) <= (b.drop as number) ? a : b));
    shown.splice(shown.indexOf(first), 1);
  }
  return line();
}

export interface HelpLine {
  /** Unique among the lines: the same key can be in two sections. */
  id: string;
  text: string;
  heading: boolean;
}

/** Every key, by where it works, for the help screen. */
export function helpLines(unicode: boolean): HelpLine[] {
  const width = Math.max(...BINDINGS.map((binding) => written(binding, unicode).length));
  return SECTIONS.flatMap(([title, has]) => [
    { id: title, text: title, heading: true },
    ...BINDINGS.filter(has).map((binding) => ({
      id: `${title} ${binding.keys}`,
      text: `  ${written(binding, unicode).padEnd(width)}  ${binding.help}`,
      heading: false,
    })),
  ]);
}
