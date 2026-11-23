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

const quoted = (text: string) => `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const words = (items: readonly string[]) => items.map(quoted).join(" ");
const rootOption = (option: string) =>
  `complete -c probe -n __fish_use_subcommand -l ${option.replace(/^--/, "")}`;

// One function completes every command: fish then filters by what is typed and shows the descriptions.
export function fishScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  const withArgument = commands.filter((command) => command.argument).map(({ name }) => name);
  return [
    "# fish completion for probe. Load it with: probe completion fish | source",
    completionMarker(version),
    "function __probe_services",
    `    ${SERVICES_QUERY}`,
    "end",
    "function __probe_environments",
    `    ${ENVIRONMENTS_QUERY}`,
    "end",
    "function __probe_tags",
    `    ${TAGS_QUERY}`,
    "end",
    "function __probe_candidates",
    "    set -l tokens (commandline -opc)",
    "    set -l at 0",
    "    for i in (seq 2 (count $tokens))",
    "        if not string match -q -- '-*' $tokens[$i]",
    "            set at $i",
    "            break",
    "        end",
    "    end",
    "    test $at -gt 0; or return",
    "    set -l cmd $tokens[$at]",
    "    set -l prev $tokens[-1]",
    "    switch $prev",
    `        case ${ENVIRONMENT_OPTION}`,
    "            __probe_environments",
    "            return",
    `        case ${TAG_OPTION}`,
    "            __probe_tags",
    "            return",
    ...Object.entries(OPTION_WORDS).flatMap(([option, values]) => [
      `        case ${option}`,
      `            printf '%s\\n' ${words(values)}`,
      "            return",
    ]),
    "    end",
    "    set -l valued",
    "    switch $cmd",
    ...commands.flatMap((command) => [
      `        case ${command.name}`,
      `            set valued ${words(valuedOptions(command))}`,
    ]),
    "    end",
    "    set -l rest $tokens",
    "    set -e rest[1..$at]",
    "    set -l type",
    "    set -l given",
    "    set -l last $cmd",
    "    for word in $rest",
    `        test "$last" = ${TYPE_OPTION}; and set type $word`,
    "        switch $word",
    `            case ${END_OF_OPTIONS}`,
    "                return",
    `            case '${TYPE_OPTION}=*'`,
    `                set type (string replace -- ${TYPE_OPTION}= '' $word)`,
    `            case ${COMMAND_OPTION} '${COMMAND_OPTION}=*'`,
    `                test -n "$type"; or set type ${COMMAND_TYPE}`,
    "            case '-*'",
    "            case '*'",
    "                contains -- $last $valued; or set given 1",
    "        end",
    "        set last $word",
    "    end",
    `    if not string match -q -- '-*' (commandline -ct)`,
    "        contains -- $prev $valued; and return",
    "        switch $cmd",
    `            case ${withServices.join(" ")}`,
    "                __probe_services",
    "                return",
    ...commands
      .filter((command) => command.words.length > 0)
      .flatMap((command) => [
        `            case ${command.name}`,
        `                printf '%s\\n' ${words(command.words)}`,
        "                return",
      ]),
    ...(withArgument.length > 0
      ? [
          `            case ${withArgument.join(" ")}`,
          '                test -n "$given"; or return',
        ]
      : []),
    "        end",
    "    end",
    "    set -l options",
    "    switch $cmd",
    ...commands.flatMap((command) => [
      `        case ${command.name}`,
      `            set options ${command.options.map((option) => `${quoted(option.name)}\\t${quoted(option.description)}`).join(" ")}`,
    ]),
    "    end",
    "    set -l allowed",
    '    switch "$cmd:$type"',
    ...commands.flatMap(({ name, byType }) =>
      Object.entries(byType).flatMap(([type, options]) => [
        `        case ${quoted(`${name}:${type}`)}`,
        `            set allowed ${words(options)}`,
      ]),
    ),
    "    end",
    "    for option in $options",
    "        set -l name (string replace -r -- '\\t.*' '' $option)",
    "        if set -q allowed[1]; and not contains -- $name $allowed",
    "            continue",
    "        end",
    `        if not contains -- $name ${words(REPEATABLE_OPTIONS)}`,
    '            if contains -- $name $rest; or string match -q -- "$name=*" $rest',
    "                continue",
    "            end",
    "        end",
    "        printf '%s\\n' $option",
    "    end",
    "end",
    // No file names: probe takes none.
    "complete -c probe -f",
    ...ROOT_OPTIONS.map(rootOption),
    ...commands.map(
      ({ name, description }) =>
        `complete -c probe -n __fish_use_subcommand -a ${name} -d ${quoted(description)}`,
    ),
    "complete -c probe -n 'not __fish_use_subcommand' -a '(__probe_candidates)'",
    "",
  ].join("\n");
}
