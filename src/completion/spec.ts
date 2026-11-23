import { addOptionsByType } from "../commands/add-flags";
import { METHODS, SERVICE_TYPES } from "../config/schema";
import { COMPLETE_COMMAND } from "../constants";

export interface OptionSpec {
  name: string;
  description: string;
  /** Takes a value: the word after it is that value, never a name or an option. */
  value: boolean;
}

export interface CommandSpec {
  name: string;
  description: string;
  options: OptionSpec[];
  words: string[];
  services: boolean;
  /** Takes a free argument first, such as a name: its options come once it is typed. */
  argument: boolean;
  /** The options a service of each type accepts, for a command that takes `--type`. */
  byType: Record<string, string[]>;
}

export interface CommandLike {
  meta?: unknown;
  args?: unknown;
}

export const SHELLS = ["zsh", "bash", "fish", "powershell"] as const;
export type Shell = (typeof SHELLS)[number];

export const COMPLETION_COMMAND = "completion";
export const SERVICE_COMMANDS = ["rm", "check", "wait", "open", "curl", "doctor"];
export const ROOT_OPTIONS = ["--interval", "--help", "--version"];
export const SERVICES_QUERY = `probe ${COMPLETE_COMMAND} services 2>/dev/null`;

export const ENVIRONMENT_OPTION = "--env";
export const ENVIRONMENTS_QUERY = `probe ${COMPLETE_COMMAND} environments 2>/dev/null`;

export const TAG_OPTION = "--tag";
export const SET_OPTION = "--set";

export const TAGS_QUERY = `probe ${COMPLETE_COMMAND} tags 2>/dev/null`;

export const TYPE_OPTION = "--type";
/** Given without `--type`, it makes a command service. */
export const COMMAND_OPTION = "--command";
export const COMMAND_TYPE = "command";
/** What follows is a command and its arguments: nothing is completed there. */
export const END_OF_OPTIONS = "--";

/** Read as many times as they are given: still offered once used. */
export const REPEATABLE_OPTIONS = ["--header", "--setenv", TAG_OPTION, SET_OPTION];

/** The options whose values are known without a project: offered after the option. */
export const OPTION_WORDS: Readonly<Record<string, readonly string[]>> = {
  [TYPE_OPTION]: SERVICE_TYPES,
  "--method": METHODS,
};

const HELP_OPTION: OptionSpec = { name: "--help", description: "Show help", value: false };
const ADD_COMMAND = "add";

type ArgLike = { type?: string; description?: string };

export function completionSpec(commands: Record<string, CommandLike>): CommandSpec[] {
  return Object.entries(commands).map(([name, command]) => {
    const meta = (command.meta ?? {}) as { description?: string };
    const args = Object.values((command.args ?? {}) as Record<string, ArgLike>);
    const options = Object.entries((command.args ?? {}) as Record<string, ArgLike>)
      .filter(([, arg]) => arg.type !== "positional")
      .map(([option, arg]) => ({
        name: `--${option}`,
        description: arg.description ?? "",
        value: arg.type !== "boolean",
      }));
    const words = name === COMPLETION_COMMAND ? [...SHELLS] : [];
    const services = SERVICE_COMMANDS.includes(name);
    const all = [...options, HELP_OPTION];
    return {
      name,
      description: meta.description ?? "",
      options: all,
      words,
      services,
      argument: !services && words.length === 0 && args.some((arg) => arg.type === "positional"),
      byType: name === ADD_COMMAND ? addOptionsByType(all.map((option) => option.name)) : {},
    };
  });
}

/** The options of the command whose next word is their value. */
export const valuedOptions = (command: CommandSpec): string[] =>
  command.options.filter((option) => option.value).map((option) => option.name);
