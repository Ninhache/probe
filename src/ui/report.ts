import { targetUrl } from "../checkers/http";
import type { CheckResult } from "../checkers/types";
import type { Config } from "../config/schema";
import { createColors } from "./colors";
import { type Terminal, truncate } from "./terminal";

const GAP = "  ";

function width(values: string[]): number {
  return Math.max(0, ...values.map((value) => value.length));
}

/** Width left to the name column when a line has to be cut: half the terminal, never under 4. */
function nameBudget(nameWidth: number, columns: number): number {
  return Math.min(nameWidth, Math.max(4, Math.floor(columns / 2)));
}

/**
 * Renders one line per check result.
 * On a terminal too narrow for the widest line, the target column is dropped and the rest is cut
 * to the width (9 columns at least); off a terminal (unknown width) lines are never cut.
 */
export function formatCheckResults(results: CheckResult[], terminal: Terminal): string {
  const colors = createColors(terminal.color);
  const nameWidth = width(results.map((result) => result.name));
  const targetWidth = width(results.map((result) => result.target));
  const outcomes = results.map((result) =>
    result.ok ? `${result.status}${GAP}${result.latencyMs}ms` : (result.error ?? "down"),
  );
  const fullWidth = 2 + nameWidth + GAP.length + targetWidth + GAP.length + width(outcomes);
  const { columns } = terminal;
  const compact = columns !== undefined && fullWidth > columns;
  const nameMax = compact ? nameBudget(nameWidth, columns) : nameWidth;
  const outcomeMax = compact ? Math.max(1, columns - 2 - nameMax - GAP.length) : undefined;

  return results
    .map((result, index) => {
      const mark = result.ok ? colors.green("✓") : colors.red("✗");
      const name = colors.bold(truncate(result.name, nameMax).padEnd(nameMax));
      const target = compact ? "" : `${colors.dim(result.target.padEnd(targetWidth))}${GAP}`;
      const plain = outcomes[index] as string;
      let outcome: string;
      if (!result.ok) {
        outcome = colors.red(outcomeMax === undefined ? plain : truncate(plain, outcomeMax));
      } else if (outcomeMax !== undefined && plain.length > outcomeMax) {
        outcome = colors.green(truncate(String(result.status), outcomeMax));
      } else {
        outcome = `${colors.green(String(result.status))}${GAP}${colors.dim(`${result.latencyMs}ms`)}`;
      }
      return `${mark} ${name}${GAP}${target}${outcome}`;
    })
    .join("\n");
}

/**
 * Renders one line per declared service.
 * On a terminal too narrow for the widest line, `expect` is dropped and the URL is cut to the width.
 */
export function formatServices(config: Config, terminal: Terminal): string {
  const colors = createColors(terminal.color);
  const rows = Object.entries(config.services).map(([name, service]) => ({
    name,
    url: targetUrl(service),
    expect: service.expect === undefined ? "" : `${GAP}expect ${service.expect}`,
  }));
  const nameWidth = width(rows.map((row) => row.name));
  const fullWidth = width(rows.map((row) => " ".repeat(nameWidth) + GAP + row.url + row.expect));
  const { columns } = terminal;
  const compact = columns !== undefined && fullWidth > columns;
  const nameMax = compact ? nameBudget(nameWidth, columns) : nameWidth;
  const urlMax = compact ? Math.max(1, columns - nameMax - GAP.length) : undefined;

  return rows
    .map((row) => {
      const name = colors.bold(truncate(row.name, nameMax).padEnd(nameMax));
      const url = urlMax === undefined ? row.url : truncate(row.url, urlMax);
      return `${name}${GAP}${url}${compact || !row.expect ? "" : colors.dim(row.expect)}`;
    })
    .join("\n");
}
