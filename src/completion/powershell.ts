import { COMPLETE_COMMAND } from "../constants";
import { CLI_VERSION } from "../version";
import { completionMarker } from "./marker";
import {
  COMMAND_OPTION,
  COMMAND_TYPE,
  type CommandSpec,
  END_OF_OPTIONS,
  ENVIRONMENT_OPTION,
  OPTION_WORDS,
  REPEATABLE_OPTIONS,
  ROOT_OPTIONS,
  TAG_OPTION,
  TYPE_OPTION,
  valuedOptions,
} from "./spec";

// PowerShell reads the typographic quotes as quotes too.
const QUOTES = /['‘’‚‛]/g;
const quoted = (text: string) => `'${text.replace(QUOTES, (quote) => quote + quote)}'`;
const list = (items: readonly string[]) => `@(${items.map(quoted).join(", ")})`;
export function powershellScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const table = (pick: (command: CommandSpec) => string[]) =>
    commands
      .filter((command) => pick(command).length > 0)
      .map((command) => `    ${quoted(command.name)} = ${list(pick(command))}`);
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  const withArgument = commands.filter((command) => command.argument).map(({ name }) => name);
  return [
    "# powershell completion for probe. Load it with: probe completion powershell | Out-String | Invoke-Expression",
    completionMarker(version),
    "Register-ArgumentCompleter -Native -CommandName probe -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    "  $commands = [ordered]@{",
    ...commands.map(({ name, description }) => `    ${quoted(name)} = ${quoted(description)}`),
    "  }",
    "  $options = @{",
    ...commands.map(
      (command) =>
        `    ${quoted(command.name)} = [ordered]@{ ${command.options.map((option) => `${quoted(option.name)} = ${quoted(option.description)}`).join("; ")} }`,
    ),
    "  }",
    "  $valued = @{",
    ...table(valuedOptions),
    "  }",
    "  $words = @{",
    ...table((command) => command.words),
    "  }",
    "  $byType = @{",
    ...commands.flatMap(({ name, byType }) =>
      Object.entries(byType).map(
        ([type, options]) => `    ${quoted(`${name}:${type}`)} = ${list(options)}`,
      ),
    ),
    "  }",
    `  $withServices = ${list(withServices)}`,
    `  $withArgument = ${list(withArgument)}`,
    `  $repeatable = ${list(REPEATABLE_OPTIONS)}`,
    `  $rootOptions = ${list(ROOT_OPTIONS)}`,
    "  # What is typed before the cursor, without probe and without the word being completed.",
    "  $typed = @($commandAst.CommandElements | Where-Object { $_.Extent.StartOffset -lt $cursorPosition } | ForEach-Object { $_.ToString() })",
    "  if ($wordToComplete -ne '' -and $typed.Count -gt 0) { $typed = @($typed | Select-Object -SkipLast 1) }",
    "  $typed = @($typed | Select-Object -Skip 1)",
    "  $command = $typed | Where-Object { -not $_.StartsWith('-') } | Select-Object -First 1",
    "  $previous = if ($typed.Count -gt 0) { $typed[-1] } else { '' }",
    "  $bare = -not $wordToComplete.StartsWith('-')",
    "  function Get-ProbeWords($kind) {",
    "    try {",
    `      @(& probe ${COMPLETE_COMMAND} $kind 2>$null | Where-Object { $_ })`,
    "    } catch { @() }",
    "  }",
    "  $tips = @{}",
    "  $candidates = @()",
    `  if ($command -and $previous -eq ${quoted(ENVIRONMENT_OPTION)}) {`,
    "    $candidates = Get-ProbeWords 'environments'",
    `  } elseif ($command -and $previous -eq ${quoted(TAG_OPTION)}) {`,
    "    $candidates = Get-ProbeWords 'tags'",
    ...Object.entries(OPTION_WORDS).flatMap(([option, words]) => [
      `  } elseif ($command -and $previous -eq ${quoted(option)}) {`,
      `    $candidates = ${list(words)}`,
    ]),
    "  } elseif (-not $command) {",
    "    if (-not $bare) { $candidates = $rootOptions }",
    "    else { $candidates = @($commands.Keys); $tips = $commands }",
    "  } else {",
    "    $rest = @($typed | Select-Object -Skip ([array]::IndexOf($typed, $command) + 1))",
    "    $valuedHere = @($valued[$command])",
    "    $type = ''",
    "    $given = $false",
    "    $ended = $false",
    "    $last = $command",
    "    foreach ($word in $rest) {",
    `      if ($last -eq ${quoted(TYPE_OPTION)}) { $type = $word }`,
    `      if ($word -eq ${quoted(END_OF_OPTIONS)}) { $ended = $true }`,
    `      elseif ($word.StartsWith(${quoted(`${TYPE_OPTION}=`)})) { $type = $word.Substring(${TYPE_OPTION.length + 1}) }`,
    `      elseif ($word -eq ${quoted(COMMAND_OPTION)} -or $word.StartsWith(${quoted(`${COMMAND_OPTION}=`)})) { if (-not $type) { $type = ${quoted(COMMAND_TYPE)} } }`,
    "      elseif (-not $word.StartsWith('-') -and $valuedHere -notcontains $last) { $given = $true }",
    "      $last = $word",
    "    }",
    "    if ($ended) {",
    "    } elseif ($bare -and $valuedHere -contains $previous) {",
    "    } elseif ($bare -and $withServices -contains $command) {",
    "      $candidates = Get-ProbeWords 'services'",
    "    } elseif ($bare -and $words[$command]) {",
    "      $candidates = $words[$command]",
    "    } elseif ($bare -and $withArgument -contains $command -and -not $given) {",
    "    } elseif ($options[$command]) {",
    "      $tips = $options[$command]",
    "      $allowed = $byType[$command + ':' + $type]",
    "      $candidates = @($tips.Keys | Where-Object {",
    "        $option = $_",
    "        $used = $rest | Where-Object { $_ -eq $option -or $_.StartsWith($option + '=') }",
    "        (-not $allowed -or $allowed -contains $option) -and ($repeatable -contains $option -or -not $used)",
    "      })",
    "    }",
    "  }",
    "  $candidates | Where-Object { $_.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {",
    "    $tip = if ($tips[$_]) { $tips[$_] } else { $_ }",
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $tip)",
    "  }",
    "}",
    "",
  ].join("\n");
}
