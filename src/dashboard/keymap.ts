export type Screen = "list" | "panel" | "filter" | "palette" | "form" | "confirm" | "help";

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
  | "help"
  | "quit";

type Section = "List" | "Panels" | "Filter" | "Add and edit" | "Outside a text field";

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
}

const list = (binding: Omit<Binding, "screens" | "section">): Binding => ({
  screens: ["list"],
  section: "List",
  ...binding,
});

const BINDINGS: readonly Binding[] = [
  list({ keys: "↑↓ jk", ascii: "jk", action: "move", help: "Move", drop: 2 }),
  list({ keys: "r", action: "check", help: "Check now", barless: true, command: "check" }),
  list({
    keys: "↵",
    ascii: "enter",
    action: "service",
    help: "Service detail",
    drop: 5,
    command: "detail",
  }),
  list({ keys: "u", action: "open", help: "Open its URL", barless: true, command: "open" }),
  list({ keys: "c", action: "copy", help: "Copy curl command", barless: true, command: "copy" }),
  list({ keys: "e", action: "edit", help: "Edit the service", barless: true, command: "edit" }),
  list({ keys: "d", action: "remove", help: "Remove it", barless: true, command: "remove" }),
  list({ keys: "a", action: "add", help: "Add a service", drop: 3, command: "add" }),
  list({ keys: "/", action: "filter", help: "Filter by name", drop: 4, command: "filter" }),
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
    command: "help",
  },
  {
    screens: ["list", "panel", "help"],
    section: "Outside a text field",
    keys: "q",
    action: "quit",
    help: "Quit",
    command: "quit",
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

export function helpLines(unicode: boolean): HelpLine[] {
  return sectionLines(SECTIONS, unicode);
}

export function helpColumns(unicode: boolean, columns: number): HelpLine[][] {
  const [first, ...others] = SECTIONS;
  const sides = [sectionLines([first as Section], unicode), sectionLines(others, unicode)];
  const widths = sides.map((side) => Math.max(...side.map(({ text }) => text.length)));
  const fits = (widths[0] as number) + HELP_GAP + (widths[1] as number) <= columns;
  return fits ? sides : [helpLines(unicode)];
}

export { HELP_GAP };
