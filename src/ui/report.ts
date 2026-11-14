import { targetUrl } from "../checkers/http";
import type { CheckResult } from "../checkers/types";
import type { Config } from "../config/schema";
import { createColors } from "./colors";
import { type Terminal, truncate } from "./terminal";

const GAP = "  ";
const SKIPPED = "skipped";

function width(values: string[]): number {
  return Math.max(0, ...values.map((value) => value.length));
}

/** Width left to the name column when a line has to be cut: half of what the other columns leave. */
function nameBudget(nameWidth: number, columns: number, reserved: number): number {
  return Math.max(1, Math.min(nameWidth, Math.floor((columns - reserved) / 2)));
}

/**
 * Renders one line per check result, followed by its hint when it has one.
 * On a terminal too narrow for the widest line, the target column is dropped and the rest is cut
 * to the width (6 columns at least); off a terminal (unknown width) lines are never cut.
 * A hint is cut to the width of the terminal, whatever the other lines need.
 */
export function formatCheckResults(results: CheckResult[], terminal: Terminal): string {
  const colors = createColors(terminal.color);
  const nameWidth = width(results.map((result) => result.name));
  const targetWidth = width(results.map((result) => result.target));
  const outcomes = results.map((result) => {
    if (result.skipped) return SKIPPED;
    return result.ok ? `${result.status}${GAP}${result.latencyMs}ms` : (result.error ?? "down");
  });
  const fullWidth = 2 + nameWidth + GAP.length + targetWidth + GAP.length + width(outcomes);
  const { columns } = terminal;
  const compact = columns !== undefined && fullWidth > columns;
  const nameMax = compact ? nameBudget(nameWidth, columns, 2 + GAP.length) : nameWidth;
  const outcomeMax = compact ? Math.max(1, columns - 2 - nameMax - GAP.length) : undefined;

  return results
    .map((result, index) => {
      const mark = result.skipped
        ? colors.dim("-")
        : result.ok
          ? colors.green("✓")
          : colors.red("✗");
      const name = colors.bold(truncate(result.name, nameMax).padEnd(nameMax));
      const target = compact ? "" : `${colors.dim(result.target.padEnd(targetWidth))}${GAP}`;
      const plain = outcomes[index] as string;
      let outcome: string;
      if (result.skipped) {
        outcome = colors.dim(outcomeMax === undefined ? plain : truncate(plain, outcomeMax));
      } else if (!result.ok) {
        outcome = colors.red(outcomeMax === undefined ? plain : truncate(plain, outcomeMax));
      } else if (outcomeMax !== undefined && plain.length > outcomeMax) {
        outcome = colors.green(truncate(String(result.status), outcomeMax));
      } else {
        outcome = `${colors.green(String(result.status))}${GAP}${colors.dim(`${result.latencyMs}ms`)}`;
      }
      const line = `${mark} ${name}${GAP}${target}${outcome}`;
      if (!result.hint) return line;
      const room = columns === undefined ? undefined : Math.max(1, columns - GAP.length);
      const hint = room === undefined ? result.hint : truncate(result.hint, room);
      return `${line}\n${GAP}${colors.dim(hint)}`;
    })
    .join("\n");
}

/**
 * Renders one line per declared service.
 * On a terminal too narrow for the widest line, the notes after the URL (`expect`, skipped) are
 * dropped and the URL is cut to the width.
 */
export function formatServices(
  config: Config,
  terminal: Terminal,
  skipped: ReadonlySet<string> = new Set(),
): string {
  const colors = createColors(terminal.color);
  const rows = Object.entries(config.services).map(([name, service]) => ({
    name,
    url: targetUrl(service),
    notes:
      (service.expect === undefined ? "" : `${GAP}expect ${service.expect}`) +
      (service.timeout === undefined ? "" : `${GAP}timeout ${service.timeout}s`) +
      (skipped.has(name) ? `${GAP}${SKIPPED}` : ""),
  }));
  const nameWidth = width(rows.map((row) => row.name));
  const fullWidth = width(rows.map((row) => " ".repeat(nameWidth) + GAP + row.url + row.notes));
  const { columns } = terminal;
  const compact = columns !== undefined && fullWidth > columns;
  const nameMax = compact ? nameBudget(nameWidth, columns, GAP.length) : nameWidth;
  const urlMax = compact ? Math.max(1, columns - nameMax - GAP.length) : undefined;

  return rows
    .map((row) => {
      const name = colors.bold(truncate(row.name, nameMax).padEnd(nameMax));
      const url = urlMax === undefined ? row.url : truncate(row.url, urlMax);
      return `${name}${GAP}${url}${compact || !row.notes ? "" : colors.dim(row.notes)}`;
    })
    .join("\n");
}
