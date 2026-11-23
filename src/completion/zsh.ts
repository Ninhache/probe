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

function described({ name, description }: CommandSpec): string {
  const text = `${name}:${description.replaceAll(":", "\\:")}`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function zshScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const cases = (pick: (command: CommandSpec) => string[]) =>
    commands
      .filter((command) => pick(command).length > 0)
      .map((command) => `    ${command.name}) compadd -- ${pick(command).join(" ")} ;;`);
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  return [
    "#compdef probe",
    completionMarker(version),
    '# zsh completion for probe. Load it after compinit with: eval "$(probe completion zsh)"',
    "_probe() {",
    "  local -a commands services",
    "  commands=(",
    ...commands.map((command) => `    ${described(command)}`),
    "  )",
    "  if (( CURRENT == 2 )); then",
    "    if [[ $words[CURRENT] == -* ]]; then",
    `      compadd -- ${ROOT_OPTIONS.join(" ")}`,
    "    else",
    "      _describe 'command' commands",
    "    fi",
    "    return",
    "  fi",
    `  if [[ $words[CURRENT-1] == ${ENVIRONMENT_OPTION} ]]; then`,
    `    services=(\${(f)"$(${ENVIRONMENTS_QUERY})"})`,
    "    compadd -a services",
    "    return",
    "  fi",
    `  if [[ $words[CURRENT-1] == ${TAG_OPTION} ]]; then`,
    `    services=(\${(f)"$(${TAGS_QUERY})"})`,
    "    compadd -a services",
    "    return",
    "  fi",
    ...Object.entries(OPTION_WORDS).flatMap(([option, words]) => [
      `  if [[ $words[CURRENT-1] == ${option} ]]; then`,
      `    compadd -- ${words.join(" ")}`,
      "    return",
      "  fi",
    ]),
    "  if [[ $words[CURRENT] == -* ]]; then",
    "    case $words[2] in",
    ...cases((command) => command.options).map((line) => `  ${line}`),
    "    esac",
    "    return",
    "  fi",
    "  case $words[2] in",
    `    ${withServices.join("|")})`,
    `      services=(\${(f)"$(${SERVICES_QUERY})"})`,
    "      compadd -a services ;;",
    ...cases((command) => command.words),
    "  esac",
    "}",
    "if (( $+functions[compdef] )); then compdef _probe probe; fi",
    "# Saved as _probe in $fpath, this file is the function itself: run it.",
    'if [[ $funcstack[1] == _probe ]]; then _probe "$@"; fi',
    "",
  ].join("\n");
}
