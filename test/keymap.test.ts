import { describe, expect, it } from "vitest";
import { HELP_GAP, helpBar, helpColumns, helpLines } from "../src/dashboard/keymap";

describe("helpBar", () => {
  it("should show the keys one needs first in the list", () => {
    expect(helpBar("list", true, 80)).toBe(
      "↑↓ jk move · ↵ service · a add · / filter · ? help · q quit",
    );
  });

  it("should show other keys in a panel", () => {
    expect(helpBar("panel", true, 100)).toBe(
      "↑↓ jk move · ←→ hl change · esc close · ? help · q quit",
    );
  });

  it.each([
    ["filter", "↑↓ move · ↵ keep · esc clear"],
    ["form", "↑↓ tab field · ↵ save · esc cancel"],
    ["confirm", "y remove · n esc keep"],
  ] as const)("should show the keys of the %s", (screen, bar) => {
    expect(helpBar(screen, true, 80)).toBe(bar);
  });

  it("should not offer to quit or to open the help where letters are typed", () => {
    for (const screen of ["filter", "form"] as const) {
      expect(helpBar(screen, true, 80)).not.toMatch(/quit|help/);
    }
  });

  it.each([60, 50, 40, 30])("should stay on one line of %i columns", (columns) => {
    for (const screen of ["list", "panel", "filter", "form", "confirm", "help"] as const) {
      expect(helpBar(screen, true, columns).length).toBeLessThanOrEqual(columns);
    }
  });

  it("should give up moving first when the line is too wide", () => {
    expect(helpBar("list", true, 50)).toBe("↵ service · a add · / filter · ? help · q quit");
    expect(helpBar("list", true, 40)).toBe("↵ service · / filter · ? help · q quit");
  });

  it("should keep the keys that lead out when nothing else fits", () => {
    expect(helpBar("list", true, 5)).toBe("? help · q quit");
    expect(helpBar("panel", true, 5)).toBe("esc close · ? help · q quit");
    expect(helpBar("form", true, 5)).toBe("↵ save · esc cancel");
  });

  it("should write the keys in ASCII without unicode", () => {
    expect(helpBar("panel", false, 100)).toBe("jk move - hl change - esc close - ? help - q quit");
    expect(helpBar("form", false, 100)).toBe("tab field - enter save - esc cancel");
  });
});

describe("helpLines", () => {
  it.each(["list", "panel"] as const)("should have a line for each key of the %s bar", (screen) => {
    const help = helpLines(true).map(({ text }) => text);

    for (const item of helpBar(screen, true, 100).split(" · ")) {
      const keys = item.slice(0, item.lastIndexOf(" "));
      expect(help.some((line) => line.startsWith(`  ${keys} `))).toBe(true);
    }
  });

  it("should give each line its own id", () => {
    const ids = helpLines(true).map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should name the sections in the order of the screens", () => {
    const headings = helpLines(true).filter(({ heading }) => heading);

    expect(headings.map(({ text }) => text)).toEqual([
      "List",
      "Panels",
      "Filter",
      "Add and edit",
      "Outside a text field",
    ]);
  });

  it.each(["r", "u", "c", "e", "d", "o"])("should list %s, which the bar leaves out", (key) => {
    expect(helpLines(true).some(({ text }) => text.startsWith(`  ${key} `))).toBe(true);
    const bar = helpBar("list", true, 200).split(" · ");

    expect(bar.some((item) => item.startsWith(`${key} `))).toBe(false);
  });
});

describe("helpColumns", () => {
  it("should put the keys of the list on the left on 80 columns, in unicode and in ASCII", () => {
    for (const unicode of [true, false]) {
      const [left = [], right = []] = helpColumns(unicode, 80);

      expect(left[0]?.text).toBe("List");
      expect(right[0]?.text).toBe("Panels");
      expect([...left, ...right]).toEqual(helpLines(unicode));
    }
  });

  it("should leave room for both columns and the gap", () => {
    const widest = (lines: { text: string }[]) => Math.max(...lines.map(({ text }) => text.length));
    const [left = [], right = []] = helpColumns(true, 80);

    expect(widest(left) + HELP_GAP + widest(right)).toBeLessThanOrEqual(80);
  });

  it("should fall back to one column when two do not fit", () => {
    expect(helpColumns(true, 50)).toEqual([helpLines(true)]);
  });

  it("should fit the height of a terminal of 24 lines in two columns", () => {
    const title = 1;
    const bar = 1;

    for (const column of helpColumns(true, 80)) {
      expect(column.length + title + bar).toBeLessThanOrEqual(24);
    }
  });
});
