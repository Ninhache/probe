import { COMPLETE_COMMAND } from "../constants";

export interface CommandSpec {
  name: string;
  description: string;
  options: string[];
  words: string[];
  services: boolean;
}

export interface CommandLike {
  meta?: unknown;
  args?: unknown;
}

export const SHELLS = ["zsh", "bash", "fish"] as const;
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

const HELP_OPTION = "--help";

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
