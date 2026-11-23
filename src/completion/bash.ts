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

// bash splits `--type=http` into `--type`, `=` and `http`: the word after `=` is a value too.
const EQUALS = "=";

// Must run on bash 3.2 (stock macOS): no `mapfile`, no associative array, loaded with `eval`.
export function bashScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const perCommand = (pick: (command: CommandSpec) => string[]) =>
    commands
      .filter((command) => pick(command).length > 0)
      .map((command) => `        ${command.name}) words="${pick(command).join(" ")}" ;;`);
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  const withArgument = commands.filter((command) => command.argument).map(({ name }) => name);
  const byType = commands.flatMap(({ name, byType }) =>
    Object.entries(byType).map(
      ([type, options]) => `        ${name}:${type}) words="${options.join(" ")}" ;;`,
    ),
  );
  return [
    '# bash completion for probe. Load it with: eval "$(probe completion bash)"',
    completionMarker(version),
    "_probe() {",
    `  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="\${COMP_WORDS[COMP_CWORD-1]}" cmd="" at=0 words="" i`,
    '  local valued="" type="" given="" offer="options" typed="" kept="" option word',
    "  for ((i = 1; i < COMP_CWORD; i++)); do",
    `    case "\${COMP_WORDS[i]}" in`,
    "      -*) ;;",
    `      *) cmd="\${COMP_WORDS[i]}"; at=$i; break ;;`,
    "    esac",
    "  done",
    `  if [ -n "$cmd" ] && [ "$prev" = "${ENVIRONMENT_OPTION}" ]; then`,
    `    words="$(${ENVIRONMENTS_QUERY})"`,
    `  elif [ -n "$cmd" ] && [ "$prev" = "${TAG_OPTION}" ]; then`,
    `    words="$(${TAGS_QUERY})"`,
    ...Object.entries(OPTION_WORDS).flatMap(([option, words]) => [
      `  elif [ -n "$cmd" ] && [ "$prev" = "${option}" ]; then`,
      `    words="${words.join(" ")}"`,
    ]),
    '  elif [ -z "$cmd" ]; then',
    '    case "$cur" in',
    `      -*) words="${ROOT_OPTIONS.join(" ")}" ;;`,
    `      *) words="${commands.map(({ name }) => name).join(" ")}" ;;`,
    "    esac",
    "  else",
    '    case "$cmd" in',
    ...commands.map(
      (command) =>
        `      ${command.name}) valued=" ${EQUALS} ${valuedOptions(command).join(" ")} " ;;`,
    ),
    "    esac",
    "    for ((i = at + 1; i < COMP_CWORD; i++)); do",
    `      word="\${COMP_WORDS[i]}"`,
    '      typed="$typed $word"',
    '      case "$word" in',
    `        ${END_OF_OPTIONS}) offer="" ;;`,
    `        ${TYPE_OPTION})`,
    `          type="\${COMP_WORDS[i+1]}"`,
    `          [ "$type" != "${EQUALS}" ] || type="\${COMP_WORDS[i+2]}" ;;`,
    `        ${TYPE_OPTION}=*) type="\${word#${TYPE_OPTION}=}" ;;`,
    `        ${COMMAND_OPTION}|${COMMAND_OPTION}=*) [ -n "$type" ] || type=${COMMAND_TYPE} ;;`,
    `        -*|${EQUALS}) ;;`,
    `        *) case "$valued" in *" \${COMP_WORDS[i-1]} "*) ;; *) given=1 ;; esac ;;`,
    "      esac",
    "    done",
    `    if [ -n "$offer" ] && [ "\${cur#-}" = "$cur" ]; then`,
    '      case "$valued" in *" $prev "*) offer="" ;; esac',
    '      case "$cmd" in',
    `        ${withServices.join("|")}) [ -z "$offer" ] || offer="services" ;;`,
    ...commands
      .filter((command) => command.words.length > 0)
      .map((command) => `        ${command.name}) [ -z "$offer" ] || offer="words" ;;`),
    ...(withArgument.length > 0
      ? [`        ${withArgument.join("|")}) [ -n "$given" ] || offer="" ;;`]
      : []),
    "      esac",
    "    fi",
    '    case "$offer" in',
    `      services) words="$(${SERVICES_QUERY})" ;;`,
    "      words)",
    '        case "$cmd" in',
    ...perCommand((command) => command.words),
    "        esac ;;",
    "      options)",
    '        case "$cmd:$type" in',
    ...byType,
    '          *) case "$cmd" in',
    ...perCommand((command) => command.options.map((option) => option.name)).map(
      (line) => `    ${line}`,
    ),
    "            esac ;;",
    "        esac",
    "        for option in $words; do",
    `          case " ${REPEATABLE_OPTIONS.join(" ")} " in *" $option "*) kept="$kept $option"; continue ;; esac`,
    '          case "$typed " in *" $option "*|*" $option="*) ;; *) kept="$kept $option" ;; esac',
    "        done",
    '        words="$kept" ;;',
    "    esac",
    "  fi",
    '  COMPREPLY=($(compgen -W "$words" -- "$cur"))',
    "}",
    "complete -F _probe probe",
    "",
  ].join("\n");
}
