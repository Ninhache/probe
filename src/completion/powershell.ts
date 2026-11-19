import { COMPLETE_COMMAND } from "../constants";
import { CLI_VERSION } from "../version";
import { completionMarker } from "./marker";
import { type CommandSpec, ENVIRONMENT_OPTION, ROOT_OPTIONS, TAG_OPTION } from "./spec";

// PowerShell reads the typographic quotes as quotes too.
const QUOTES = /['‘’‚‛]/g;
const quoted = (text: string) => `'${text.replace(QUOTES, (quote) => quote + quote)}'`;
const list = (items: string[]) => `@(${items.map(quoted).join(", ")})`;
export function powershellScript(commands: CommandSpec[], version: string = CLI_VERSION): string {
  const table = (pick: (command: CommandSpec) => string[]) =>
    commands
      .filter((command) => pick(command).length > 0)
      .map((command) => `    ${quoted(command.name)} = ${list(pick(command))}`);
  const withServices = commands.filter((command) => command.services).map(({ name }) => name);
  return [
    "# powershell completion for probe. Load it with: probe completion powershell | Out-String | Invoke-Expression",
    completionMarker(version),
    "Register-ArgumentCompleter -Native -CommandName probe -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    "  $commands = [ordered]@{",
    ...commands.map(({ name, description }) => `    ${quoted(name)} = ${quoted(description)}`),
    "  }",
    "  $options = @{",
    ...table((command) => command.options),
    "  }",
    "  $words = @{",
    ...table((command) => command.words),
    "  }",
    `  $withServices = ${list(withServices)}`,
    `  $rootOptions = ${list(ROOT_OPTIONS)}`,
    "  # What is typed before the cursor, without probe and without the word being completed.",
    "  $typed = @($commandAst.CommandElements | Where-Object { $_.Extent.StartOffset -lt $cursorPosition } | ForEach-Object { $_.ToString() })",
    "  if ($wordToComplete -ne '' -and $typed.Count -gt 0) { $typed = @($typed | Select-Object -SkipLast 1) }",
    "  $typed = @($typed | Select-Object -Skip 1)",
    "  $command = $typed | Where-Object { -not $_.StartsWith('-') } | Select-Object -First 1",
    "  $previous = if ($typed.Count -gt 0) { $typed[-1] } else { '' }",
    "  function Get-ProbeWords($kind) {",
    "    try {",
    `      @(& probe ${COMPLETE_COMMAND} $kind 2>$null | Where-Object { $_ })`,
    "    } catch { @() }",
    "  }",
    "  $tips = @{}",
    `  if ($command -and $previous -eq ${quoted(ENVIRONMENT_OPTION)}) {`,
    "    $candidates = Get-ProbeWords 'environments'",
    `  } elseif ($command -and $previous -eq ${quoted(TAG_OPTION)}) {`,
    "    $candidates = Get-ProbeWords 'tags'",
    "  } elseif (-not $command) {",
    "    if ($wordToComplete.StartsWith('-')) { $candidates = $rootOptions }",
    "    else { $candidates = @($commands.Keys); $tips = $commands }",
    "  } elseif ($wordToComplete.StartsWith('-')) {",
    "    $candidates = $options[$command]",
    "  } else {",
    "    $candidates = if ($withServices -contains $command) { Get-ProbeWords 'services' } else { $words[$command] }",
    "  }",
    "  $candidates | Where-Object { $_.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {",
    "    $tip = if ($tips[$_]) { $tips[$_] } else { $_ }",
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $tip)",
    "  }",
    "}",
    "",
  ].join("\n");
}
