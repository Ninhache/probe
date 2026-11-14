import { COMPLETE_COMMAND } from "../constants";

/** What a shell needs to complete one command. */
export interface CommandSpec {
  name: string;
  description: string;
  /** Long options, with their dashes. */
  options: string[];
  /** Words the command takes as argument, when they are a fixed list. */
  words: string[];
  /** Whether the command takes service names as arguments. */
  services: boolean;
}

/** A command as citty holds it, reduced to what the completion reads. */
export interface CommandLike {
  meta?: unknown;
  args?: unknown;
}

export const SHELLS = ["zsh", "bash", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

export const COMPLETION_COMMAND = "completion";
/** Commands whose arguments are service names. */
export const SERVICE_COMMANDS = ["rm", "check", "wait", "open", "curl"];
export const ROOT_OPTIONS = ["--interval", "--help", "--version"];
/** The command line a script runs to get the service names, one per line. */
export const SERVICES_QUERY = `probe ${COMPLETE_COMMAND} services 2>/dev/null`;

const HELP_OPTION = "--help";

/** Describes every command for the completion scripts, from the commands citty runs. */
export function completionSpec(commands: Record<string, CommandLike>): CommandSpec[] {
  return Object.entries(commands).map(([name, command]) => {
    const meta = (command.meta ?? {}) as { description?: string };
    const args = (command.args ?? {}) as Record<string, { type?: string }>;
    const options = Object.entries(args)
      .filter(([, arg]) => arg.type !== "positional")
      .map(([option]) => `--${option}`);
    return {
      name,
      description: meta.description ?? "",
      options: [...options, HELP_OPTION],
      words: name === COMPLETION_COMMAND ? [...SHELLS] : [],
      services: SERVICE_COMMANDS.includes(name),
    };
  });
}
