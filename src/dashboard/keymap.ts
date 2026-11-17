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
  | "help";

export type Command =
  | "check"
  | "detail"
  | "open"
  | "copy"
  | "edit"
  | "remove"
  | "add"
  | "filter"
  | "options"
  | "parameters"
  | "undo"
  | "help"
  | "quit";

type Section =
  | "List"
  | "Panels"
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
  screens: ["list"],
  section: "List",
  ...binding,
});

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
  list({ keys: "a", action: "add", help: "Add a service", drop: 3, command: "add" }),
  list({ keys: "z", action: "undo", help: "Undo last change", barless: true, command: "undo" }),
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
    keys: "←→ hl",
    ascii: "hl",
    action: "parameter",
    help: "Change parameter",
    drop: 1,
    parameters: true,
  },
  {
    screens: ["choose"],
    section: "Parameters",
    keys: "↑↓ jk",
    ascii: "jk",
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
  {
    screens: ["list", "panel", "readonly", "choose"],
    section: "Outside a text field",
    keys: "?",
    action: "help",
    help: "This help",
    command: "help",
  },
  {
    screens: ["list", "panel", "readonly", "choose", "help"],
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
  "Filter",
  "Add and edit",
  "Outside a text field",
];

const written = (binding: Binding, unicode: boolean) =>
  unicode ? binding.keys : (binding.ascii ?? binding.keys);

const offered = (grid: boolean) => BINDINGS.filter((binding) => grid || !binding.grid);

export function helpBar(
  screen: Screen,
  unicode: boolean,
  columns: number,
  grid = false,
  parameters = false,
): string {
  const shown = offered(grid).filter(
    (binding) =>
      binding.screens.includes(screen) && !binding.barless && (parameters || !binding.parameters),
  );
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

export function keyCommand(input: string, enter: boolean): Command | undefined {
  return BINDINGS.find(({ keys, command }) => command && (enter ? keys === "↵" : keys === input))
    ?.command;
}

export interface PaletteEntry {
  command: Command;
  label: string;
  keys: string;
}

export function paletteEntries(unicode: boolean, query = ""): PaletteEntry[] {
  const wanted = query.trim().toLowerCase();
  return BINDINGS.flatMap((binding) => {
    const { command, help, action } = binding;
    if (!command || !help || !`${help} ${action}`.toLowerCase().includes(wanted)) return [];
    return [{ command, label: help, keys: written(binding, unicode) }];
  });
}

export interface HelpLine {
  /** Unique among the lines: the same key can be in two sections. */
  id: string;
  text: string;
  heading: boolean;
}

const HELP_GAP = 3;
const LEFT_SECTIONS = 2;

function sectionLines(sections: readonly Section[], unicode: boolean, grid: boolean): HelpLine[] {
  const described = offered(grid).filter(({ help }) => help !== undefined);
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
