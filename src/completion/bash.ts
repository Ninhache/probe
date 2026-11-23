import { CLI_VERSION } from "../version";
import { completionMarker } from "./marker";
import {
  type CommandSpec,
  ENVIRONMENT_OPTION,
  ENVIRONMENTS_QUERY,
  OPTION_WORDS,
  ROOT_OPTIONS,
  SERVICES_QUERY,
  TAG_OPTION,
  TAGS_QUERY,
} from "./spec";

// Must run on bash 3.2 (stock macOS): no `mapfile`, no associative array, loaded with `eval`.
export function bashScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const cases = (pick: (command: CommandSpec) => string[]) =>
    commands
      .filter((command) => pick(command).length > 0)
      .map((command) => `      ${command.name}) words="${pick(command).join(" ")}" ;;`);
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  return [
    '# bash completion for probe. Load it with: eval "$(probe completion bash)"',
    completionMarker(version),
    "_probe() {",
    `  local cur="\${COMP_WORDS[COMP_CWORD]}" cmd="" words="" i`,
    "  for ((i = 1; i < COMP_CWORD; i++)); do",
    `    case "\${COMP_WORDS[i]}" in`,
    "      -*) ;;",
    `      *) cmd="\${COMP_WORDS[i]}"; break ;;`,
    "    esac",
    "  done",
    `  if [ -n "$cmd" ] && [ "\${COMP_WORDS[COMP_CWORD-1]}" = "${ENVIRONMENT_OPTION}" ]; then`,
    `    words="$(${ENVIRONMENTS_QUERY})"`,
    `  elif [ -n "$cmd" ] && [ "\${COMP_WORDS[COMP_CWORD-1]}" = "${TAG_OPTION}" ]; then`,
    `    words="$(${TAGS_QUERY})"`,
    ...Object.entries(OPTION_WORDS).flatMap(([option, words]) => [
      `  elif [ -n "$cmd" ] && [ "\${COMP_WORDS[COMP_CWORD-1]}" = "${option}" ]; then`,
      `    words="${words.join(" ")}"`,
    ]),
    '  elif [ -z "$cmd" ]; then',
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
