import { answer, targetOf } from "../checkers/registry";
import type { CheckResult } from "../checkers/types";
import type { Config } from "../config/schema";
import { CONTAINS_SHOWN_CHARACTERS } from "../constants";
import { createColors } from "./colors";
import { type Glyphs, UNICODE_GLYPHS } from "./glyphs";
import { link } from "./links";
import { type Terminal, truncate } from "./terminal";

const GAP = "  ";
const SKIPPED = "skipped";
const LOCAL = "local";

function width(values: string[]): number {
  return Math.max(0, ...values.map((value) => value.length));
}

function nameBudget(nameWidth: number, columns: number, reserved: number): number {
  return Math.max(1, Math.min(nameWidth, Math.floor((columns - reserved) / 2)));
}

export function formatCheckResults(
  results: CheckResult[],
  terminal: Terminal,
  glyphs: Glyphs = UNICODE_GLYPHS,
): string {
  const colors = createColors(terminal.color);
  const nameWidth = width(results.map((result) => result.name));
  const targetWidth = width(results.map((result) => result.target));
  const outcomes = results.map((result) => {
    if (result.skipped) return SKIPPED;
    return result.ok ? `${answer(result)}${GAP}${result.latencyMs}ms` : (result.error ?? "down");
  });
  // The mark and the space after it.
  const lead = glyphs.ok.length + 1;
  const fullWidth = lead + nameWidth + GAP.length + targetWidth + GAP.length + width(outcomes);
  const { columns } = terminal;
  const compact = columns !== undefined && fullWidth > columns;
  const nameMax = compact ? nameBudget(nameWidth, columns, lead + GAP.length) : nameWidth;
  const outcomeMax = compact ? Math.max(1, columns - lead - nameMax - GAP.length) : undefined;

  return results
    .map((result, index) => {
      const mark = result.skipped
        ? colors.dim(glyphs.skipped)
        : result.ok
          ? colors.green(glyphs.ok)
          : colors.red(glyphs.fail);
      const name = colors.bold(truncate(result.name, nameMax).padEnd(nameMax));
      const padding = " ".repeat(targetWidth - result.target.length);
      const linked = link(result.target, result.target, terminal.hyperlinks);
      const target = compact ? "" : `${colors.dim(`${linked}${padding}`)}${GAP}`;
      const plain = outcomes[index] as string;
      let outcome: string;
      if (result.skipped) {
        outcome = colors.dim(outcomeMax === undefined ? plain : truncate(plain, outcomeMax));
      } else if (!result.ok) {
        outcome = colors.red(outcomeMax === undefined ? plain : truncate(plain, outcomeMax));
      } else if (outcomeMax !== undefined && plain.length > outcomeMax) {
        outcome = colors.green(truncate(answer(result), outcomeMax));
      } else {
        outcome = `${colors.green(answer(result))}${GAP}${colors.dim(`${result.latencyMs}ms`)}`;
      }
      const line = `${mark} ${name}${GAP}${target}${outcome}`;
      if (!result.hint) return line;
      const room = columns === undefined ? undefined : Math.max(1, columns - GAP.length);
      const hint = room === undefined ? result.hint : truncate(result.hint, room);
      return `${line}\n${GAP}${colors.dim(hint)}`;
    })
    .join("\n");
}

const localKeys = (keys: readonly string[]) => (keys.length > 0 ? ` ${keys.join(", ")}` : "");

export function formatServices(
  config: Config,
  terminal: Terminal,
  skipped: ReadonlySet<string> = new Set(),
  /** The keys whose value comes from local.yml, by service, none for one it adds: named, their values are shown above. */
  local: Readonly<Record<string, readonly string[]>> = {},
): string {
  const colors = createColors(terminal.color);
  const rows = Object.entries(config.services).map(([name, service]) => ({
    name,
    url: targetOf(service),
    notes:
      (service.method === undefined ? "" : `${GAP}${service.method}`) +
      (service.expect === undefined ? "" : `${GAP}expect ${service.expect}`) +
      (service.contains === undefined
        ? ""
        : `${GAP}contains ${truncate(service.contains, CONTAINS_SHOWN_CHARACTERS)}`) +
      (service.timeout === undefined ? "" : `${GAP}timeout ${service.timeout}s`) +
      // Names only: a value may come from a secret.
      (service.headers ? `${GAP}sends ${Object.keys(service.headers).join(", ")}` : "") +
      (service.env ? `${GAP}sets ${Object.keys(service.env).join(", ")}` : "") +
      (service.tags?.length ? `${GAP}tags ${service.tags.join(", ")}` : "") +
      (local[name] === undefined ? "" : `${GAP}${LOCAL}${localKeys(local[name])}`) +
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
      const shown = urlMax === undefined ? row.url : truncate(row.url, urlMax);
      const url = link(shown, row.url, terminal.hyperlinks);
      return `${name}${GAP}${url}${compact || !row.notes ? "" : colors.dim(row.notes)}`;
    })
    .join("\n");
}
