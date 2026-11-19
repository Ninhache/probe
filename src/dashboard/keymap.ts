export type Screen =
  | "list"
  | "panel"
  | "choose"
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
  | "undo"
  | "redo"
  | "help"
  | "quit";

type Section =
  | "List"
  | "Panels"
  | "Service detail"
  | "Parameters"
  | "Filter"
  | "Add and edit"
  | "Outside a text field";

interface Binding {
  screens: readonly Screen[];
  keys: string;
  ascii?: string;
  action: string;
  help?: string;
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

const list = (binding: Omit<Binding, "screens" | "section">): Binding => ({
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
    barless: true,
    command: "log",
  }),
  list({
    keys: "2",
    action: "response",
    help: "Response tab",
    barless: true,
    command: "response",
  }),
  list({
    keys: "b",
    action: "copy body",
    help: "Copy the response body",
    barless: true,
    command: "body",
  }),
  list({
    keys: "f",
    action: "changes only",
    help: "Log changes only",
    barless: true,
    command: "changes",
  }),
  list({
    keys: "y",
    action: "copy lines",
    help: "Copy the log lines on screen",
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
  peek({ keys: "1", action: "log", drop: 4 }),
  list({
    keys: "n",
    action: "new env",
    help: "New environment",
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
  response({ keys: "r", action: "details", help: "Back to the detail", drop: 2 }),
  response({ keys: "esc", action: "close", help: "Close" }),
];

const BINDINGS: readonly Binding[] = [
  list({ keys: "↑↓ jk", ascii: "jk", action: "move", help: "Move", drop: 2 }),
  list({
    keys: "←→ hl",
    ascii: "hl",
    action: "environment",
    help: "Change environment",
    drop: 7,
    grid: true,
  }),
  list({ keys: "r", action: "check", help: "Check now", barless: true, command: "check" }),
  list({
    keys: "↵",
    ascii: "enter",
    action: "service",
    help: "Service detail",
    drop: 6,
    command: "detail",
  }),
  list({ keys: "u", action: "open", help: "Open its URL", barless: true, command: "open" }),
  list({ keys: "c", action: "copy", help: "Copy curl command", barless: true, command: "copy" }),
  list({ keys: "e", action: "edit", help: "Edit the service", barless: true, command: "edit" }),
  list({ keys: "d", action: "remove", help: "Remove it", barless: true, command: "remove" }),
  list({
    keys: "D",
    action: "remove env",
    help: "Remove the environment",
    barless: true,
    command: "removeEnvironment",
  }),
  list({ keys: "a", action: "add", help: "Add a service", drop: 3, command: "add" }),
  list({ keys: "z", action: "undo", help: "Undo last change", barless: true, command: "undo" }),
  list({ keys: "Z", action: "redo", help: "Redo what z undid", barless: true, command: "redo" }),
  list({ keys: "/", action: "filter", help: "Filter by name", drop: 5, command: "filter" }),
  list({
    keys: "p",
    action: "parameters",
    help: "Parameter values",
    drop: 4,
    command: "parameters",
    parameters: true,
  }),
  list({ keys: ":", action: "commands", help: "Find a command", drop: 1 }),
  list({ keys: "o", action: "options", help: "Options", barless: true, command: "options" }),
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
    section: "Outside a text field",
    keys: "?",
    action: "help",
    help: "This help",
    command: "help",
  },
  {
    screens: ["list", "peek", "log", "panel", "readonly", "choose", "help"],
    section: "Outside a text field",
    keys: "q",
    action: "quit",
    help: "Quit",
    command: "quit",
  },
];

const SECTIONS: readonly Section[] = [
  "List",
  "Parameters",
  "Panels",
  "Service detail",
  "Filter",
  "Add and edit",
  "Outside a text field",
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
    const { command, help, action } = binding;
    if (!command || !help || !`${help} ${action}`.toLowerCase().includes(wanted)) return [];
    return [{ command, label: help, keys: written(binding, unicode) }];
  });
}

export interface HelpLine {
  /** Unique among the lines: the same key can be in two sections, or on two screens of one. */
  id: string;
  text: string;
  heading: boolean;
}

const HELP_GAP = 3;
const LEFT_SECTIONS = 2;

function sectionLines(sections: readonly Section[], unicode: boolean, grid: boolean): HelpLine[] {
  const described = offered(grid).filter(({ help }) => help !== undefined);
  const width = Math.max(...described.map((binding) => written(binding, unicode).length));
  const present = sections.filter((title) => described.some(({ section }) => section === title));
  return present.flatMap((title) => [
    { id: title, text: title, heading: true },
    ...described
      .filter(({ section }) => section === title)
      .map((binding) => ({
        id: `${title} ${binding.screens.join("+")} ${binding.keys}`,
        text: `  ${written(binding, unicode).padEnd(width)}  ${binding.help}`,
        heading: false,
      })),
  ]);
}

export function helpLines(unicode: boolean, grid = false): HelpLine[] {
  return sectionLines(SECTIONS, unicode, grid);
}

export function helpColumns(unicode: boolean, columns: number, grid = false): HelpLine[][] {
  // The list and the parameters it opens on the left: both columns then fit 24 lines.
  const sides = [
    sectionLines(SECTIONS.slice(0, LEFT_SECTIONS), unicode, grid),
    sectionLines(SECTIONS.slice(LEFT_SECTIONS), unicode, grid),
  ];
  const widths = sides.map((side) => Math.max(...side.map(({ text }) => text.length)));
  const fits = (widths[0] as number) + HELP_GAP + (widths[1] as number) <= columns;
  return fits ? sides : [helpLines(unicode, grid)];
}

export { HELP_GAP };
