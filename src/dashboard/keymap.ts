export type Screen =
  | "list"
  | "panel"
  | "choose"
  | "variables"
  | "readonly"
  | "filter"
  | "palette"
  | "form"
  | "input"
  | "confirm"
  | "detail"
  | "response"
  | "peek"
  | "log"
  | "help";

export type Command =
  | "check"
  | "detail"
  | "open"
  | "copy"
  | "body"
  | "trace"
  | "response"
  | "log"
  | "changes"
  | "copylog"
  | "edit"
  | "remove"
  | "add"
  | "environment"
  | "removeEnvironment"
  | "filter"
  | "options"
  | "parameters"
  | "variables"
  | "undo"
  | "redo"
  | "help"
  | "news"
  | "quit";

type Section =
  | "Move"
  | "Service"
  | "View"
  | "Edit"
  | "List"
  | "Panels"
  | "Service detail"
  | "Parameters"
  | "Filter"
  | "Add and edit"
  | "General";

interface Binding {
  screens: readonly Screen[];
  keys: string;
  ascii?: string;
  action: string;
  help?: string;
  /** `help` in a few words, for the compact help of the current screen. */
  short?: string;
  /** What the palette calls it when the help has no line for it. */
  palette?: string;
  section?: Section;
  /** Rank at which the bar gives it up when it is too wide, lowest first; unset: always shown. */
  drop?: number;
  barless?: true;
  command?: Command;
  /** Only when several environments are shown. */
  grid?: true;
  /** In the bar only when the selected config declares parameters. */
  parameters?: true;
}

const list = (binding: Omit<Binding, "screens">): Binding => ({
  screens: ["list", "peek", "log"],
  section: "List",
  ...binding,
});

const detail = (binding: Omit<Binding, "screens" | "section">): Binding => ({
  screens: ["detail"],
  section: "Service detail",
  ...binding,
});

const response = (binding: Omit<Binding, "screens" | "section">): Binding => ({
  screens: ["response"],
  section: "Service detail",
  ...binding,
});

/** The bar of the list while its response tab is open: the keys that tab adds. */
const peek = (binding: Omit<Binding, "screens" | "section">): Binding => ({
  screens: ["peek"],
  section: "List",
  ...binding,
});

/** The bar of the list while its log tab is open: the keys that tab adds, given up first. */
const logBar = (binding: Omit<Binding, "screens" | "section">): Binding => ({
  screens: ["log"],
  section: "List",
  ...binding,
});

const NATIVE_LIST_BINDINGS: readonly Binding[] = [
  list({
    keys: "1",
    action: "log",
    help: "Log tab",
    section: "View",
    short: "Log",
    barless: true,
    command: "log",
  }),
  list({
    keys: "2",
    action: "response",
    help: "Response tab",
    section: "View",
    short: "Response",
    barless: true,
    command: "response",
  }),
  list({
    keys: "b",
    action: "copy body",
    help: "Copy the response body",
    section: "Service",
    short: "Copy body",
    barless: true,
    command: "body",
  }),
  list({
    keys: "w",
    action: "save response",
    // No help line: the help of the list is full. The response panel's line names the file.
    palette: "Save the response to .probe/traces",
    barless: true,
    command: "trace",
  }),
  list({
    keys: "f",
    action: "changes only",
    help: "Log changes only",
    section: "View",
    short: "Changes",
    barless: true,
    command: "changes",
  }),
  list({
    keys: "y",
    action: "copy lines",
    help: "Copy visible log lines",
    section: "View",
    short: "Copy log",
    barless: true,
    command: "copylog",
  }),
  logBar({ keys: "PgUp PgDn", action: "scroll", drop: 0 }),
  logBar({ keys: "End", action: "follow", drop: 0 }),
  logBar({ keys: "f", action: "changes only", drop: 0 }),
  logBar({ keys: "y", action: "copy lines", drop: 0 }),
  logBar({ keys: "2", action: "response", drop: 0 }),
  peek({ keys: "PgUp PgDn", action: "scroll", drop: 3 }),
  peek({ keys: "u", action: "open", drop: 1 }),
  peek({ keys: "b", action: "copy body", drop: 1 }),
  peek({ keys: "w", action: "save", drop: 1 }),
  peek({ keys: "1", action: "log", drop: 4 }),
  list({
    keys: "n",
    action: "new env",
    help: "New environment",
    section: "Edit",
    short: "New env",
    // First to go: at 80 columns the bar stays what it was.
    drop: 0,
    command: "environment",
  }),
];

const DETAIL_BINDINGS: readonly Binding[] = [
  detail({ keys: "←→", ascii: "arrows", action: "timeout", help: "Service timeout", drop: 3 }),
  detail({ keys: "s", action: "skip", help: "Skip the service", drop: 2 }),
  detail({ keys: "u", action: "open", help: "Open its URL", drop: 1 }),
  detail({ keys: "c", action: "copy", help: "Copy curl command", drop: 1 }),
  {
    screens: ["detail", "readonly"],
    section: "Service detail",
    keys: "r",
    action: "response",
    help: "Full response",
    drop: 2,
  },
  detail({ keys: "esc", action: "close", help: "Close" }),
  response({ keys: "↑↓", ascii: "arrows", action: "scroll", help: "Scroll", drop: 3 }),
  response({ keys: "c", action: "copy response", help: "Copy the response", drop: 1 }),
  response({ keys: "b", action: "copy body", help: "Copy the body", drop: 1 }),
  response({
    keys: "w",
    action: "save response",
    help: "Save the response",
    drop: 1,
  }),
  response({ keys: "r", action: "details", help: "Back to the detail", drop: 2 }),
  response({ keys: "esc", action: "close", help: "Close" }),
];

const BINDINGS: readonly Binding[] = [
  list({
    keys: "↑↓ jk",
    ascii: "jk",
    action: "move",
    help: "Move",
    section: "Move",
    short: "Move",
    drop: 2,
  }),
  list({
    keys: "←→ hl",
    ascii: "hl",
    action: "environment",
    help: "Change environment",
    section: "Move",
    short: "Env",
    drop: 7,
    grid: true,
  }),
  list({
    keys: "r",
    action: "check",
    help: "Check now",
    section: "Service",
    short: "Check",
    barless: true,
    command: "check",
  }),
  list({
    keys: "↵",
    ascii: "enter",
    action: "service",
    help: "Service detail",
    section: "Move",
    short: "Detail",
    drop: 6,
    command: "detail",
  }),
  list({
    keys: "u",
    action: "open",
    help: "Open its URL",
    section: "Service",
    short: "Open URL",
    barless: true,
    command: "open",
  }),
  list({
    keys: "c",
    action: "copy",
    help: "Copy curl command",
    section: "Service",
    short: "Copy curl",
    barless: true,
    command: "copy",
  }),
  list({
    keys: "e",
    action: "edit",
    help: "Edit the service",
    section: "Service",
    short: "Edit",
    barless: true,
    command: "edit",
  }),
  list({
    keys: "d",
    action: "remove",
    help: "Remove it",
    section: "Service",
    short: "Remove",
    barless: true,
    command: "remove",
  }),
  list({
    keys: "D",
    action: "remove env",
    help: "Remove the environment",
    section: "Edit",
    short: "Remove env",
    barless: true,
    command: "removeEnvironment",
  }),
  list({
    keys: "a",
    action: "add",
    help: "Add a service",
    section: "Edit",
    short: "Add",
    drop: 3,
    command: "add",
  }),
  list({
    keys: "z",
    action: "undo",
    help: "Undo last change",
    section: "Edit",
    short: "Undo",
    barless: true,
    command: "undo",
  }),
  list({
    keys: "Z",
    action: "redo",
    help: "Redo what z undid",
    section: "Edit",
    short: "Redo",
    barless: true,
    command: "redo",
  }),
  list({
    keys: "/",
    action: "filter",
    help: "Filter by name",
    section: "Move",
    short: "Filter",
    drop: 5,
    command: "filter",
  }),
  list({
    keys: "p",
    action: "parameters",
    help: "Parameter values",
    section: "View",
    short: "Params",
    drop: 4,
    command: "parameters",
    parameters: true,
  }),
  list({
    keys: "v",
    action: "variables",
    help: "Header variables",
    section: "View",
    short: "Headers",
    drop: 0,
    command: "variables",
  }),
  list({
    keys: ":",
    action: "commands",
    help: "Find a command",
    section: "Move",
    short: "Palette",
    drop: 1,
  }),
  list({
    keys: "o",
    action: "options",
    help: "Options",
    section: "General",
    short: "Options",
    barless: true,
    command: "options",
  }),
  list({
    keys: "W",
    action: "what's new",
    help: "What's new",
    section: "Move",
    short: "News",
    barless: true,
    command: "news",
  }),
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
  {
    screens: ["panel"],
    section: "Panels",
    keys: "↵",
    ascii: "enter",
    action: "set",
    help: "Set the variable",
    barless: true,
  },
  {
    screens: ["panel", "readonly"],
    section: "Panels",
    keys: "esc",
    action: "close",
    help: "Close",
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "↑↓ jk",
    ascii: "jk",
    action: "parameter",
    help: "Change parameter",
    drop: 1,
    parameters: true,
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "←→ hl",
    ascii: "hl",
    action: "value",
    help: "Choose its value",
    parameters: true,
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "a",
    action: "add",
    help: "Add a parameter",
    drop: 3,
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "e",
    action: "edit",
    help: "Edit the parameter",
    drop: 2,
    parameters: true,
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "d",
    action: "remove",
    help: "Remove it",
    drop: 2,
    parameters: true,
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "p esc",
    action: "close",
    help: "Close",
  },
  {
    screens: ["variables"],
    section: "Panels",
    keys: "↑↓ jk",
    ascii: "jk",
    action: "move",
    drop: 1,
  },
  {
    screens: ["variables"],
    section: "Panels",
    keys: "↵",
    ascii: "enter",
    action: "set",
    drop: 2,
  },
  {
    screens: ["variables"],
    section: "Panels",
    keys: "d",
    action: "remove",
    drop: 2,
  },
  {
    screens: ["variables"],
    section: "Panels",
    keys: "v esc",
    action: "close",
  },
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
    help: "Keep the filter",
  },
  { screens: ["filter"], section: "Filter", keys: "esc", action: "clear", help: "Clear it" },
  { screens: ["palette"], keys: "↑↓", ascii: "arrows", action: "move", drop: 1 },
  { screens: ["palette"], keys: "↵", ascii: "enter", action: "run" },
  { screens: ["palette"], keys: "esc", action: "close" },
  {
    screens: ["form"],
    section: "Add and edit",
    keys: "↑↓ tab",
    ascii: "tab",
    action: "field",
    help: "Change field",
    drop: 1,
  },
  {
    screens: ["form", "input"],
    section: "Add and edit",
    keys: "↵",
    ascii: "enter",
    action: "save",
    help: "Save",
  },
  {
    screens: ["form", "input"],
    section: "Add and edit",
    keys: "ctrl+u",
    action: "empty",
    help: "Empty the field",
    drop: 2,
  },
  {
    screens: ["form", "input"],
    section: "Add and edit",
    keys: "esc",
    action: "cancel",
    help: "Cancel",
  },
  { screens: ["confirm"], keys: "y", action: "remove" },
  { screens: ["confirm"], keys: "n esc", action: "keep" },
  { screens: ["help"], keys: "? esc", action: "close" },
  ...DETAIL_BINDINGS,
  ...NATIVE_LIST_BINDINGS,
  {
    screens: ["list", "peek", "log", "panel", "readonly", "choose"],
    section: "General",
    keys: "?",
    action: "help",
    help: "This help",
    short: "Help",
    command: "help",
  },
  {
    screens: ["list", "peek", "log", "panel", "readonly", "choose", "help"],
    section: "General",
    keys: "q",
    action: "quit",
    help: "Quit",
    short: "Quit",
    command: "quit",
  },
];

const SECTIONS: readonly Section[] = [
  "Move",
  "Service",
  "View",
  "Edit",
  "Parameters",
  "Panels",
  "Service detail",
  "Filter",
  "Add and edit",
  "General",
];

const written = (binding: Binding, unicode: boolean) =>
  unicode ? binding.keys : (binding.ascii ?? binding.keys);

const offered = (grid: boolean) => BINDINGS.filter((binding) => grid || !binding.grid);

export interface BarItem {
  keys: string;
  action: string;
}

/** The bindings the bar shows, dropping the lowest ranked ones until `columns` is enough. */
export function helpBarItems(
  screen: Screen,
  unicode: boolean,
  columns: number,
  grid = false,
  parameters = false,
): BarItem[] {
  const shown = offered(grid).filter(
    (binding) =>
      binding.screens.includes(screen) && !binding.barless && (parameters || !binding.parameters),
  );
  const separator = unicode ? " · " : " - ";
  const width = () =>
    shown.reduce(
      (sum, binding, i) =>
        sum + (i ? separator.length : 0) + `${written(binding, unicode)} ${binding.action}`.length,
      0,
    );
  while (width() > columns) {
    const droppable = shown.filter(({ drop }) => drop !== undefined);
    if (droppable.length === 0) break;
    const first = droppable.reduce((a, b) => ((a.drop as number) <= (b.drop as number) ? a : b));
    shown.splice(shown.indexOf(first), 1);
  }
  return shown.map((binding) => ({ keys: written(binding, unicode), action: binding.action }));
}

export function keyCommand(input: string, enter: boolean): Command | undefined {
  return offered(true).find(
    ({ keys, command }) => command && (enter ? keys === "↵" : keys === input),
  )?.command;
}

export interface PaletteEntry {
  command: Command;
  label: string;
  keys: string;
}

export function paletteEntries(unicode: boolean, query = ""): PaletteEntry[] {
  const wanted = query.trim().toLowerCase();
  return offered(true).flatMap((binding) => {
    const { command, action } = binding;
    const label = binding.help ?? binding.palette;
    if (!command || !label || !`${label} ${action}`.toLowerCase().includes(wanted)) return [];
    return [{ command, label, keys: written(binding, unicode) }];
  });
}

export interface HelpLine {
  /** Unique among the lines: the same key can be in two sections, or on two screens of one. */
  id: string;
  text: string;
  heading: boolean;
  /** How many leading characters of `text` are the indent and the keys: the rest is the description. */
  keysEnd?: number;
}

/** Which keys the help lists: those of a screen, the others, or all of them. */
export type HelpPart = "current" | "rest" | "all";

const HELP_GAP = 3;
const INDENT = "  ";
/** Columns the current keys may use: they are short, and four sections of about six keys fit 80 columns. */
const CURRENT_COLUMNS = 5;
const REST_COLUMNS = 2;

const inPart = (binding: Binding, screen: Screen | undefined, part: HelpPart) => {
  if (part === "all" || screen === undefined) return true;
  return binding.screens.includes(screen) === (part === "current");
};

/**
 * The lines of the sections. `compact` writes the short descriptions and aligns the keys of each
 * section on their own, so that narrow sections sit side by side.
 */
function sectionLines(
  sections: readonly Section[],
  unicode: boolean,
  grid: boolean,
  keep: (binding: Binding) => boolean = () => true,
  compact = false,
): HelpLine[] {
  const described = offered(grid).filter((binding) => binding.help !== undefined && keep(binding));
  const keyWidth = (kept: readonly Binding[]) =>
    Math.max(0, ...kept.map((binding) => written(binding, unicode).length));
  const present = sections.filter((title) => described.some(({ section }) => section === title));
  return present.flatMap((title) => {
    const own = described.filter(({ section }) => section === title);
    const width = keyWidth(compact ? own : described);
    return [
      { id: title, text: title, heading: true },
      ...own.map((binding) => ({
        id: `${title} ${binding.screens.join("+")} ${binding.keys}`,
        text: `${INDENT}${written(binding, unicode).padEnd(width)}  ${(compact && binding.short) || binding.help}`,
        heading: false,
        keysEnd: INDENT.length + width,
      })),
    ];
  });
}

export function helpLines(unicode: boolean, grid = false): HelpLine[] {
  return sectionLines(SECTIONS, unicode, grid);
}

/**
 * The help in columns that fit `columns`, or in one when they do not.
 * `part` narrows it to the keys of `screen` (in short) or to all the others.
 */
export function helpColumns(
  unicode: boolean,
  columns: number,
  grid = false,
  screen?: Screen,
  part: HelpPart = "all",
): HelpLine[][] {
  const keep = (binding: Binding) => inPart(binding, screen, part);
  const compact = part === "current";
  const stacked = sectionLines(SECTIONS, unicode, grid, keep, compact);
  return pack(stacked, columns, compact ? CURRENT_COLUMNS : REST_COLUMNS);
}

const widthOf = (lines: readonly HelpLine[]) =>
  Math.max(0, ...lines.map(({ text }) => text.length));

/**
 * Whole sections, in order, in at most `most` columns: the shortest arrangement that fits `columns`,
 * or one column when none does.
 */
function pack(lines: HelpLine[], columns: number, most: number): HelpLine[][] {
  const sections: HelpLine[][] = [];
  for (const line of lines) {
    if (line.heading) sections.push([line]);
    else sections.at(-1)?.push(line);
  }
  let best: HelpLine[][] | undefined;
  let height = Number.POSITIVE_INFINITY;
  // Each bit says whether a column starts at that section.
  for (let cuts = 0; cuts < 2 ** Math.max(0, sections.length - 1); cuts++) {
    const arranged: HelpLine[][] = [[]];
    sections.forEach((section, i) => {
      if (i > 0 && cuts & (1 << (i - 1))) arranged.push([]);
      arranged.at(-1)?.push(...section);
    });
    if (arranged.length > most) continue;
    const used = arranged.reduce((sum, column) => sum + widthOf(column), 0);
    if (used + HELP_GAP * (arranged.length - 1) > columns) continue;
    const tallest = Math.max(...arranged.map((column) => column.length));
    if (tallest < height) {
      best = arranged;
      height = tallest;
    }
  }
  return best ?? [lines];
}

export { HELP_GAP };
