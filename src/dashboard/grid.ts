import { answer, type CheckResult } from "../checkers/types";
import type { Colors } from "../ui/colors";
import { truncate } from "../ui/terminal";

export interface GridColumn {
  name: string;
  /** Unset until the first pass ends. */
  results?: readonly CheckResult[];
  problem?: string;
}

export interface Grid {
  header: string;
  rows: string[];
  /** How many columns the width leaves out, on both sides of those drawn. */
  hidden: number;
}

const LEAD_WIDTH = 2;
const CELL_GAP = 1;
const CELL_MIN = 10;
const CELL_MAX = 26;
const NAME_SHARE = 4;
const NAME_GAP = 1;

export function rowNames(columns: readonly GridColumn[]): string[] {
  return [...new Set(columns.flatMap(({ results }) => (results ?? []).map(({ name }) => name)))];
}

export function upCount(results: readonly CheckResult[]): { up: number; checked: number } {
  const checked = results.filter(({ skipped }) => !skipped);
  return { up: checked.filter(({ ok }) => ok).length, checked: checked.length };
}

function cellText(column: GridColumn, name: string, room: number, pending: string): string {
  if (column.problem !== undefined) return "";
  if (!column.results) return pending;
  const result = column.results.find((found) => found.name === name);
  if (!result) return "";
  if (result.skipped) return "- skipped";
  if (!result.ok) return `✗ ${result.error ?? "down"}`;
  const full = `✓ ${answer(result)} ${result.latencyMs}ms`;
  return full.length > room ? `✓ ${answer(result)}` : full;
}

function tone(column: GridColumn, name: string): "good" | "bad" | "dim" {
  const result = column.results?.find((found) => found.name === name);
  if (!result || result.skipped) return "dim";
  return result.ok ? "good" : "bad";
}

export function formatGrid(
  names: readonly string[],
  columns: readonly GridColumn[],
  selected: { row: number; column: number },
  { width, unicode, colors }: { width: number; unicode: boolean; colors: Colors },
): Grid {
  const longest = Math.max(1, ...names.map((name) => name.length));
  const nameWidth = Math.max(1, Math.min(longest, Math.floor(width / NAME_SHARE)));
  const room = Math.max(1, width - nameWidth - NAME_GAP);
  const visible = Math.max(1, Math.min(columns.length, Math.floor(room / CELL_MIN)));
  const first = Math.max(0, Math.min(selected.column - visible + 1, columns.length - visible));
  const drawn = columns.slice(first, first + visible);
  const cellWidth = Math.max(
    LEAD_WIDTH + 1 + CELL_GAP,
    Math.min(CELL_MAX, Math.floor(room / visible)),
  );
  const textWidth = cellWidth - LEAD_WIDTH - CELL_GAP;
  const marker = unicode ? "› " : "> ";
  const pending = unicode ? "…" : "...";
  const sized = (text: string) => truncate(text, textWidth).padEnd(textWidth + CELL_GAP);

  const header = drawn
    .map((column, index) => {
      const count = column.results ? upCount(column.results) : undefined;
      const state =
        column.problem !== undefined ? " !" : count ? ` ${count.up}/${count.checked}` : "";
      const label = sized(`${column.name}${state}`);
      const text = `${" ".repeat(LEAD_WIDTH)}${label}`;
      return first + index === selected.column ? colors.bold(text) : colors.dim(text);
    })
    .join("");

  const rows = names.map((name, row) => {
    const cells = drawn.map((column, index) => {
      const active = row === selected.row && first + index === selected.column;
      const text = sized(cellText(column, name, textWidth, pending));
      const painted = { good: colors.green, bad: colors.red, dim: colors.dim }[tone(column, name)];
      return `${active ? marker : " ".repeat(LEAD_WIDTH)}${painted(text)}`;
    });
    const label = truncate(name, nameWidth).padEnd(nameWidth);
    return `${row === selected.row ? colors.bold(label) : label}${" ".repeat(NAME_GAP)}${cells.join("")}`;
  });

  return {
    header: `${" ".repeat(nameWidth + NAME_GAP)}${header}`,
    rows,
    hidden: columns.length - drawn.length,
  };
}
