import { type Colors, createColors } from "./colors";
import { formatExamples } from "./examples";

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);

interface ArgLike {
  type?: string;
  description?: string;
  alias?: string | string[];
  valueHint?: string;
  default?: unknown;
  required?: boolean;
}

/** The part of a citty command that the help reads. */
export interface HelpCommand {
  meta?: Resolvable<{ name?: string; description?: string } | undefined>;
  args?: Resolvable<Record<string, ArgLike> | undefined>;
}

interface Group {
  title: string;
  /** Detailed groups list a description per command, the others only the names. */
  detailed: boolean;
  commands: readonly string[];
}

// Which commands the root help puts where. A command missing here still shows up, under "More".
const GROUPS: readonly Group[] = [
  { title: "Daily", detailed: true, commands: ["check", "wait", "open", "curl", "ls"] },
  {
    title: "Set up",
    detailed: false,
    commands: ["init", "add", "rm", "env", "var", "sync", "completion"],
  },
  { title: "Troubleshoot", detailed: false, commands: ["status", "doctor", "migrate"] },
];
const OTHER_TITLE = "More";

// Service names are read from the raw arguments, so no definition declares them.
const SERVICE_NAMES = "[names]";
const COMMANDS_TAKING_NAMES = new Set(["check", "wait", "doctor"]);

const INDENT = "  ";
const GAP = "  ";
const WRAP_WIDTH = 80;
// `-p, `: a one-letter alias, its comma and the space after it.
const SHORT_FLAG_WIDTH = 4;
const DOT = " · ";
const USAGE_NOTE = "probe alone opens the dashboard";
const USAGE_NOTE_GAP = "        ";
const DEFAULT_TAIL = /^\(default\b/;

async function resolved<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const withoutNote = (text: string) => text.replace(/\s*\([^)]*\)\s*$/, "");
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - text.length));

interface Word {
  text: string;
  dim: boolean;
}

/** Words of a description, the trailing `(default ...)` note marked to be dimmed. */
function words(description: string, fallbackDefault?: unknown): Word[] {
  const all = description.split(/\s+/).filter(Boolean);
  const start = all.findIndex((word) => DEFAULT_TAIL.test(word));
  const out = all.map((text, index) => ({ text, dim: start !== -1 && index >= start }));
  if (start === -1 && fallbackDefault !== undefined)
    out.push(
      ...`(default ${String(fallbackDefault)})`.split(" ").map((text) => ({ text, dim: true })),
    );
  return out;
}

/** Lays rows out as `left  description`, wrapping the description under its own column. */
function table(
  rows: { left: string; styledLeft: string; words: Word[] }[],
  colors: Colors,
): string[] {
  const column = Math.max(...rows.map((row) => row.left.length));
  const room = Math.max(20, WRAP_WIDTH - INDENT.length - column - GAP.length);
  const lines: string[] = [];
  for (const row of rows) {
    const chunks: string[] = [];
    let current: Word[] = [];
    let length = 0;
    for (const word of row.words) {
      const next = length === 0 ? word.text.length : length + 1 + word.text.length;
      if (next > room && current.length > 0) {
        chunks.push(render(current, colors));
        current = [];
        length = 0;
      }
      current.push(word);
      length = length === 0 ? word.text.length : length + 1 + word.text.length;
    }
    if (current.length > 0) chunks.push(render(current, colors));
    chunks.forEach((chunk, index) => {
      const left =
        index === 0 ? row.styledLeft + " ".repeat(column - row.left.length) : " ".repeat(column);
      lines.push(`${INDENT}${left}${GAP}${chunk}`);
    });
    if (chunks.length === 0) lines.push(`${INDENT}${row.styledLeft}`);
  }
  return lines;
}

function render(line: Word[], colors: Colors): string {
  return line.map((word) => (word.dim ? colors.dim(word.text) : word.text)).join(" ");
}

function aliasesOf(arg: ArgLike): string[] {
  return [arg.alias ?? []].flat();
}

function optionRows(args: Record<string, ArgLike>, colors: Colors) {
  const options = Object.entries(args).filter(([, arg]) => arg.type !== "positional");
  // Long flags line up under the ones that carry a short alias: `-p, --port`.
  const aliased = options.some(([, arg]) => aliasesOf(arg).length > 0);
  return options.map(([name, arg]) => {
    const short = aliasesOf(arg)
      .map((alias) => `-${alias}, `)
      .join("");
    const flag = `${aliased ? pad(short, SHORT_FLAG_WIDTH) : short}--${name}`;
    const hint = arg.type === "string" ? ` <${arg.valueHint ?? name}>` : "";
    return {
      left: flag + hint,
      styledLeft: colors.cyan(flag) + colors.dim(hint),
      words: words(arg.description ?? "", arg.default),
    };
  });
}

function section(title: string, lines: string[], colors: Colors): string[] {
  return lines.length === 0 ? [] : [colors.bold(title), ...lines, ""];
}

function join(blocks: string[][]): string {
  return `${blocks.flat().join("\n").trimEnd()}\n`;
}

export interface RootHelpInput {
  version: string;
  description: string;
  commands: Record<string, HelpCommand>;
  args: Record<string, ArgLike>;
  color: boolean;
  /** No `.probe/` was found from the working directory upward. */
  firstRun: boolean;
}

/** The help of `probe` alone: commands by purpose, then the dashboard options. */
export async function renderRootHelp(input: RootHelpInput): Promise<string> {
  const colors = createColors(input.color);
  const names = Object.keys(input.commands);
  const listed = new Set(GROUPS.flatMap((group) => group.commands));
  const groups = [...GROUPS];
  const unlisted = names.filter((name) => !listed.has(name));
  if (unlisted.length > 0) groups.push({ title: OTHER_TITLE, detailed: false, commands: unlisted });

  const blocks: string[][] = [
    [
      `${colors.bold("probe")} ${input.version}${DOT}${lowerFirst(input.description)}`,
      "",
      `Usage: probe [command] [options]${USAGE_NOTE_GAP}${colors.dim(USAGE_NOTE)}`,
      "",
    ],
  ];
  if (input.firstRun)
    blocks.push([
      `First run: cd into your project folder, then run ${colors.cyan("`probe init`")}`,
      "",
    ]);

  for (const group of groups) {
    const present = group.commands.filter((name) => names.includes(name));
    if (present.length === 0) continue;
    if (!group.detailed) {
      blocks.push(
        section(group.title, [INDENT + present.map(colors.cyan).join(colors.dim(DOT))], colors),
      );
      continue;
    }
    const rows = await Promise.all(
      present.map(async (name) => {
        const command = input.commands[name] as HelpCommand;
        const description = (await resolved(command.meta))?.description ?? "";
        const rest = await restOf(name, command);
        return { name, rest, description: withoutNote(description) };
      }),
    );
    const nameWidth = Math.max(...rows.map((row) => row.name.length));
    const tableRows = rows.map(({ name, rest, description }) => ({
      left: pad(name, nameWidth) + (rest ? ` ${rest}` : ""),
      styledLeft: colors.cyan(pad(name, nameWidth)) + (rest ? colors.dim(` ${rest}`) : ""),
      words: words(description),
    }));
    blocks.push(section(group.title, table(tableRows, colors), colors));
  }

  blocks.push(section("Options", table(optionRows(input.args, colors), colors), colors));
  blocks.push([colors.dim("probe <command> --help for details")]);
  return join(blocks);
}

/** What follows the command name on its usage line: `<name>`, `[names]`. */
async function restOf(name: string, command: HelpCommand): Promise<string> {
  const args = (await resolved(command.args)) ?? {};
  const given = Object.entries(args)
    .filter(([, arg]) => arg.type === "positional")
    .map(([argName, arg]) => (arg.required ? `<${argName}>` : `[${argName}]`));
  if (COMMANDS_TAKING_NAMES.has(name)) given.push(SERVICE_NAMES);
  return given.join(" ");
}

export interface CommandHelpInput {
  name: string;
  command: HelpCommand;
  color: boolean;
}

/** The help of `probe <command>`: usage, arguments, every option, at most a few examples. */
export async function renderCommandHelp(input: CommandHelpInput): Promise<string> {
  const colors = createColors(input.color);
  const { command, name } = input;
  const description = (await resolved(command.meta))?.description ?? "";
  const args = (await resolved(command.args)) ?? {};
  const rest = await restOf(name, command);
  const options = optionRows(args, colors);
  const positionals = Object.entries(args)
    .filter(([, arg]) => arg.type === "positional" && arg.description)
    .map(([argName, arg]) => ({
      left: argName,
      styledLeft: colors.cyan(argName),
      words: words(arg.description ?? ""),
    }));
  const usage = ["Usage: probe", name, rest, options.length > 0 ? "[options]" : ""]
    .filter(Boolean)
    .join(" ");
  const examples = formatExamples(name, input.color);
  return join([
    [`${colors.bold("probe")} ${colors.cyan(name)}${DOT}${description}`, "", usage, ""],
    positionals.length > 0 ? section("Arguments", table(positionals, colors), colors) : [],
    options.length > 0 ? section("Options", table(options, colors), colors) : [],
    examples ? [examples] : [],
  ]);
}
