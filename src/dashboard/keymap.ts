/** Where the keys go: the list, a panel under it, the filter being typed, the form, the question, the help. */
export type Screen = "list" | "panel" | "filter" | "form" | "confirm" | "help";

type Section = "List" | "Panels" | "Filter" | "Add and edit" | "Outside a text field";

interface Binding {
  screens: readonly Screen[];
  keys: string;
  /** How to write the keys on a terminal without unicode. */
  ascii?: string;
  /** One word, for the bar. */
  action: string;
  /** A few words, for the help; unset: the key is not in the help. */
  help?: string;
  /** Where the help lists it. */
  section?: Section;
  /** Rank at which the bar gives it up when it is too wide, lowest first; unset: always shown. */
  drop?: number;
  /** In the help only: the bar keeps to the keys one needs first. */
  barless?: true;
}

const list = (binding: Omit<Binding, "screens" | "section">): Binding => ({
  screens: ["list"],
  section: "List",
  ...binding,
});

/**
 * Every key of the dashboard. The bar and the help are drawn from this table, in this order:
 * a new key is one entry here and one branch where keys are handled.
 */
const BINDINGS: readonly Binding[] = [
  list({ keys: "↑↓ jk", ascii: "jk", action: "move", help: "Move", drop: 1 }),
  list({ keys: "r", action: "check", help: "Check now", barless: true }),
  list({ keys: "↵", ascii: "enter", action: "service", help: "Settings of the service", drop: 4 }),
  list({ keys: "u", action: "open", help: "Open its URL in a browser", barless: true }),
  list({ keys: "c", action: "copy", help: "Copy its curl command", barless: true }),
  list({ keys: "e", action: "edit", help: "Edit its port, host, path", barless: true }),
  list({ keys: "d", action: "remove", help: "Remove it (asks first)", barless: true }),
  list({ keys: "a", action: "add", help: "Add a service", drop: 2 }),
  list({ keys: "/", action: "filter", help: "Filter by name", drop: 3 }),
  list({ keys: "o", action: "options", help: "Options: interval, timeout", barless: true }),
  {
    screens: ["panel"],
    section: "Panels",
    keys: "↑↓ jk",
    ascii: "jk",
    action: "move",
    help: "Move",
    drop: 1,
  },
  {
    screens: ["panel"],
    section: "Panels",
    keys: "←→ hl",
    ascii: "hl",
    action: "change",
    help: "Change the value",
    drop: 2,
  },
  { screens: ["panel"], section: "Panels", keys: "esc", action: "close", help: "Close" },
  {
    screens: ["filter"],
    section: "Filter",
    keys: "↑↓",
    ascii: "arrows",
    action: "move",
    help: "Move",
    drop: 1,
  },
  {
    screens: ["filter"],
    section: "Filter",
    keys: "↵",
    ascii: "enter",
    action: "keep",
    help: "Keep it, back to the list",
  },
  { screens: ["filter"], section: "Filter", keys: "esc", action: "clear", help: "Clear it" },
  {
    screens: ["form"],
    section: "Add and edit",
    keys: "↑↓ tab",
    ascii: "tab",
    action: "field",
    help: "Next or previous field",
    drop: 1,
  },
  {
    screens: ["form"],
    section: "Add and edit",
    keys: "↵",
    ascii: "enter",
    action: "save",
    help: "Save",
  },
  { screens: ["form"], section: "Add and edit", keys: "esc", action: "cancel", help: "Cancel" },
  { screens: ["confirm"], keys: "y", action: "remove" },
  { screens: ["confirm"], keys: "n esc", action: "keep" },
  { screens: ["help"], keys: "? esc", action: "close" },
  {
    screens: ["list", "panel"],
    section: "Outside a text field",
    keys: "?",
    action: "help",
    help: "This help",
  },
  {
    screens: ["list", "panel", "help"],
    section: "Outside a text field",
    keys: "q",
    action: "quit",
    help: "Quit",
  },
];

const SECTIONS: readonly Section[] = [
  "List",
  "Panels",
  "Filter",
  "Add and edit",
  "Outside a text field",
];

const written = (binding: Binding, unicode: boolean) =>
  unicode ? binding.keys : (binding.ascii ?? binding.keys);

/**
 * The keys of a screen on one line. Too wide for `columns`, it gives up the keys one guesses
 * (moving first) and keeps those that lead out: help, close, quit.
 */
export function helpBar(screen: Screen, unicode: boolean, columns: number): string {
  const shown = BINDINGS.filter(({ screens, barless }) => screens.includes(screen) && !barless);
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

/** The space between the two columns of the help. */
const HELP_GAP = 3;

/** The keys of some sections, each under its title. */
function sectionLines(sections: readonly Section[], unicode: boolean): HelpLine[] {
  const described = BINDINGS.filter(({ help }) => help !== undefined);
  const width = Math.max(...described.map((binding) => written(binding, unicode).length));
  return sections.flatMap((title) => [
    { id: title, text: title, heading: true },
    ...described
      .filter(({ section }) => section === title)
      .map((binding) => ({
        id: `${title} ${binding.keys}`,
        text: `  ${written(binding, unicode).padEnd(width)}  ${binding.help}`,
        heading: false,
      })),
  ]);
}

/** Every key, by where it works, for the help screen. */
export function helpLines(unicode: boolean): HelpLine[] {
  return sectionLines(SECTIONS, unicode);
}

/**
 * The help as the columns to draw side by side: the keys of the list on the left, the others on
 * the right, so it fits the height of a terminal. One column when `columns` has no room for two.
 */
export function helpColumns(unicode: boolean, columns: number): HelpLine[][] {
  const [first, ...others] = SECTIONS;
  const sides = [sectionLines([first as Section], unicode), sectionLines(others, unicode)];
  const widths = sides.map((side) => Math.max(...side.map(({ text }) => text.length)));
  const fits = (widths[0] as number) + HELP_GAP + (widths[1] as number) <= columns;
  return fits ? sides : [helpLines(unicode)];
}

export { HELP_GAP };
