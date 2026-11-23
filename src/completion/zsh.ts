import { CLI_VERSION } from "../version";
import { completionMarker } from "./marker";
import {
  COMMAND_OPTION,
  COMMAND_TYPE,
  type CommandSpec,
  END_OF_OPTIONS,
  ENVIRONMENT_OPTION,
  ENVIRONMENTS_QUERY,
  OPTION_WORDS,
  REPEATABLE_OPTIONS,
  ROOT_OPTIONS,
  SERVICES_QUERY,
  TAG_OPTION,
  TAGS_QUERY,
  TYPE_OPTION,
  valuedOptions,
} from "./spec";

const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const described = (name: string, description: string) =>
  quoted(`${name}:${description.replaceAll(":", "\\:")}`);
const spaced = (items: string[]) => quoted(` ${items.join(" ")} `);

export function zshScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const perCommand = (pick: (command: CommandSpec) => string | undefined) =>
    commands.flatMap((command) => {
      const line = pick(command);
      return line === undefined ? [] : [`    ${command.name}) ${line} ;;`];
    });
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  const withArgument = commands.filter((command) => command.argument).map(({ name }) => name);
  const byType = commands.flatMap(({ name, byType }) =>
    Object.entries(byType).map(
      ([type, options]) => `    ${name}:${type}) allowed=(${options.join(" ")}) ;;`,
    ),
  );
  return [
    "#compdef probe",
    completionMarker(version),
    '# zsh completion for probe. Load it after compinit with: eval "$(probe completion zsh)"',
    "_probe() {",
    "  local -a commands services options allowed offered typed",
    "  local cmd=$words[2] prev=$words[CURRENT-1] valued type given option name i",
    "  commands=(",
    ...commands.map((command) => `    ${described(command.name, command.description)}`),
    "  )",
    "  if (( CURRENT == 2 )); then",
    "    if [[ $words[CURRENT] == -* ]]; then",
    `      compadd -- ${ROOT_OPTIONS.join(" ")}`,
    "    else",
    "      _describe 'command' commands",
    "    fi",
    "    return",
    "  fi",
    `  if [[ $prev == ${ENVIRONMENT_OPTION} ]]; then`,
    `    services=(\${(f)"$(${ENVIRONMENTS_QUERY})"})`,
    "    compadd -a services",
    "    return",
    "  fi",
    `  if [[ $prev == ${TAG_OPTION} ]]; then`,
    `    services=(\${(f)"$(${TAGS_QUERY})"})`,
    "    compadd -a services",
    "    return",
    "  fi",
    ...Object.entries(OPTION_WORDS).flatMap(([option, words]) => [
      `  if [[ $prev == ${option} ]]; then`,
      `    compadd -- ${words.join(" ")}`,
      "    return",
      "  fi",
    ]),
    `  typed=("\${(@)words[3,CURRENT-1]}")`,
    `  (( \${typed[(Ie)${END_OF_OPTIONS}]} )) && return`,
    "  case $cmd in",
    ...perCommand((command) => `valued=${spaced(valuedOptions(command))}`).map(
      (line) => `  ${line}`,
    ),
    "  esac",
    "  for (( i = 3; i < CURRENT; i++ )); do",
    "    case $words[i] in",
    `      ${TYPE_OPTION}) type=$words[i+1] ;;`,
    `      ${TYPE_OPTION}=*) type=\${words[i]#${TYPE_OPTION}=} ;;`,
    `      ${COMMAND_OPTION}|${COMMAND_OPTION}=*) [[ -n $type ]] || type=${COMMAND_TYPE} ;;`,
    "      -*) ;;",
    '      *) [[ $valued == *" $words[i-1] "* ]] || given=1 ;;',
    "    esac",
    "  done",
    "  if [[ $words[CURRENT] != -* ]]; then",
    '    [[ $valued == *" $prev "* ]] && return',
    "    case $cmd in",
    `      ${withServices.join("|")})`,
    `        services=(\${(f)"$(${SERVICES_QUERY})"})`,
    "        compadd -a services",
    "        return ;;",
    ...commands
      .filter((command) => command.words.length > 0)
      .map((command) => `      ${command.name}) compadd -- ${command.words.join(" ")}; return ;;`),
    ...(withArgument.length > 0
      ? [`      ${withArgument.join("|")}) [[ -n $given ]] || return 0 ;;`]
      : []),
    "    esac",
    "  fi",
    "  case $cmd in",
    ...commands.map(
      (command) =>
        `    ${command.name}) options=(${command.options.map((option) => described(option.name, option.description)).join(" ")}) ;;`,
    ),
    "  esac",
    "  case $cmd:$type in",
    ...byType,
    "  esac",
    "  for option in $options; do",
    `    name=\${option%%:*}`,
    `    (( $#allowed )) && (( ! \${allowed[(Ie)$name]} )) && continue`,
    `    if [[ ${spaced(REPEATABLE_OPTIONS)} != *" $name "* ]] && (( \${typed[(Ie)$name]} || \${typed[(I)$name=*]} )); then`,
    "      continue",
    "    fi",
    '    offered+=("$option")',
    "  done",
    "  _describe 'option' offered",
    "}",
    "if (( $+functions[compdef] )); then compdef _probe probe; fi",
    "# Saved as _probe in $fpath, this file is the function itself: run it.",
    'if [[ $funcstack[1] == _probe ]]; then _probe "$@"; fi',
    "",
  ].join("\n");
}
