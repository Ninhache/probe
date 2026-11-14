import { type CommandSpec, ROOT_OPTIONS, SERVICES_QUERY } from "./spec";

const quoted = (text: string) => `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const longOption = (option: string) => `-l ${option.replace(/^--/, "")}`;

/** Renders the fish completion script: loaded with `source`, or saved in fish's completions directory. */
export function fishScript(commands: CommandSpec[]): string {
  const inCommand = (names: string[]) => `-n '__fish_seen_subcommand_from ${names.join(" ")}'`;
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  return [
    "# fish completion for probe. Load it with: probe completion fish | source",
    "function __probe_services",
    `    ${SERVICES_QUERY}`,
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
