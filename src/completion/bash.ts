import { type CommandSpec, ROOT_OPTIONS, SERVICES_QUERY } from "./spec";

/**
 * Renders the bash completion script. It must run on bash 3.2 (stock macOS): no `mapfile`,
 * no associative array, and it is loaded with `eval`, as `source <(...)` does nothing there.
 */
export function bashScript(commands: CommandSpec[]): string {
  const cases = (pick: (command: CommandSpec) => string[]) =>
    commands
      .filter((command) => pick(command).length > 0)
      .map((command) => `      ${command.name}) words="${pick(command).join(" ")}" ;;`);
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  return [
    '# bash completion for probe. Load it with: eval "$(probe completion bash)"',
    "_probe() {",
    `  local cur="\${COMP_WORDS[COMP_CWORD]}" cmd="" words="" i`,
    "  for ((i = 1; i < COMP_CWORD; i++)); do",
    `    case "\${COMP_WORDS[i]}" in`,
    "      -*) ;;",
    `      *) cmd="\${COMP_WORDS[i]}"; break ;;`,
    "    esac",
    "  done",
    '  if [ -z "$cmd" ]; then',
    '    case "$cur" in',
    `      -*) words="${ROOT_OPTIONS.join(" ")}" ;;`,
    `      *) words="${commands.map(({ name }) => name).join(" ")}" ;;`,
    "    esac",
    `  elif [ "\${cur#-}" != "$cur" ]; then`,
    '    case "$cmd" in',
    ...cases((command) => command.options),
    "    esac",
    "  else",
    '    case "$cmd" in',
    `      ${withServices.join("|")}) words="$(${SERVICES_QUERY})" ;;`,
    ...cases((command) => command.words),
    "    esac",
    "  fi",
    '  COMPREPLY=($(compgen -W "$words" -- "$cur"))',
    "}",
    "complete -F _probe probe",
    "",
  ].join("\n");
}
