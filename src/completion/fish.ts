import {
  type CommandSpec,
  ENVIRONMENT_OPTION,
  ENVIRONMENTS_QUERY,
  ROOT_OPTIONS,
  SERVICES_QUERY,
  TAG_OPTION,
  TAGS_QUERY,
} from "./spec";

const quoted = (text: string) => `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const VALUES: Record<string, string> = {
  [ENVIRONMENT_OPTION]: "__probe_environments",
  [TAG_OPTION]: "__probe_tags",
};
const longOption = (option: string) =>
  `-l ${option.replace(/^--/, "")}${Object.hasOwn(VALUES, option) ? ` -x -a '(${VALUES[option]})'` : ""}`;

export function fishScript(commands: CommandSpec[]): string {
  const inCommand = (names: string[]) => `-n '__fish_seen_subcommand_from ${names.join(" ")}'`;
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  return [
    "# fish completion for probe. Load it with: probe completion fish | source",
    "function __probe_services",
    `    ${SERVICES_QUERY}`,
    "end",
    "function __probe_environments",
    `    ${ENVIRONMENTS_QUERY}`,
    "end",
    "function __probe_tags",
    `    ${TAGS_QUERY}`,
    "end",
    // No file names: probe takes none.
    "complete -c probe -f",
    ...ROOT_OPTIONS.map(
      (option) => `complete -c probe -n __fish_use_subcommand ${longOption(option)}`,
    ),
    ...commands.map(
      ({ name, description }) =>
        `complete -c probe -n __fish_use_subcommand -a ${name} -d ${quoted(description)}`,
    ),
    `complete -c probe ${inCommand(withServices)} -a '(__probe_services)'`,
    ...commands.flatMap((command) => [
      ...command.options.map(
        (option) => `complete -c probe ${inCommand([command.name])} ${longOption(option)}`,
      ),
      ...(command.words.length > 0
        ? [`complete -c probe ${inCommand([command.name])} -a ${quoted(command.words.join(" "))}`]
        : []),
    ]),
    "",
  ].join("\n");
}
