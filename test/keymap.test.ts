import { describe, expect, it } from "vitest";
import {
  HELP_GAP,
  helpBarItems,
  helpColumns,
  helpLines,
  keyCommand,
  paletteEntries,
  type Screen,
} from "../src/dashboard/keymap";

const helpBar = (
  ...args: [screen: Screen, unicode: boolean, columns: number, grid?: boolean, parameters?: boolean]
) =>
  helpBarItems(...args)
    .map(({ keys, action }) => `${keys} ${action}`)
    .join(args[1] ? " · " : " - ");

describe("helpBar", () => {
  it("should show the keys one needs first in the list", () => {
    expect(helpBar("list", true, 80)).toBe(
      "↑↓ jk move · ↵ service · a add · / filter · : commands · ? help · q quit",
    );
  });

  it("should show n new env when there is room, and give it up first", () => {
    expect(helpBar("list", true, 100)).toContain("n new env");
    expect(helpBar("list", true, 80)).not.toContain("new env");
    expect(helpBar("list", true, 80)).toContain(": commands");
  });

  it("should show other keys in a panel", () => {
    expect(helpBar("panel", true, 100)).toBe(
      "↑↓ jk move · ←→ hl change · esc close · ? help · q quit",
    );
  });

  it.each([
    ["filter", "↑↓ move · ↵ keep · esc clear"],
    ["palette", "↑↓ move · ↵ run · esc close"],
    ["form", "↑↓ tab field · ↵ save · ctrl+u empty · esc cancel"],
    ["input", "↵ save · ctrl+u empty · esc cancel"],
    ["confirm", "y remove · n esc keep"],
  ] as const)("should show the keys of the %s", (screen, bar) => {
    expect(helpBar(screen, true, 80)).toBe(bar);
  });

  it("should not offer to quit or to open the help where letters are typed", () => {
    for (const screen of ["filter", "palette", "form"] as const) {
      expect(helpBar(screen, true, 80)).not.toMatch(/quit|help/);
    }
  });

  it.each([60, 50, 40, 30])("should stay on one line of %i columns", (columns) => {
    for (const screen of [
      "list",
      "panel",
      "filter",
      "palette",
      "form",
      "confirm",
      "help",
    ] as const) {
      expect(helpBar(screen, true, columns).length).toBeLessThanOrEqual(columns);
    }
  });

  it("should give up the palette, then moving, when the line is too wide", () => {
    expect(helpBar("list", true, 60)).toBe(
      "↑↓ jk move · ↵ service · a add · / filter · ? help · q quit",
    );
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
    expect(helpBar("form", false, 100)).toBe("tab field - enter save - ctrl+u empty - esc cancel");
  });
});

describe("helpLines", () => {
  it.each(["list", "panel"] as const)("should have a line for each key of the %s bar", (screen) => {
    const help = helpLines(true).map(({ text }) => text);

    // The items, not the bar text: an action can be several words ("new env").
    for (const { keys } of helpBarItems(screen, true, 100)) {
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
      "Move",
      "Service",
      "View",
      "Edit",
      "Parameters",
      "Panels",
      "Service detail",
      "Filter",
      "Add and edit",
      "General",
    ]);
  });

  it.each(["r", "u", "c", "e", "d", "o"])("should list %s, which the bar leaves out", (key) => {
    expect(helpLines(true).some(({ text }) => text.startsWith(`  ${key} `))).toBe(true);
    const bar = helpBar("list", true, 200).split(" · ");

    expect(bar.some((item) => item.startsWith(`${key} `))).toBe(false);
  });
});

describe("paletteEntries", () => {
  it("should offer every key of the list the help names, but moving and itself", () => {
    // `w` is in the palette with no line in the help, which is full: see the next test.
    const offered = paletteEntries(true).filter(({ command }) => command !== "trace");
    const lines = helpLines(true).map(({ text }) => text);

    for (const { keys, label } of offered) {
      expect(
        lines.some((line) => line.startsWith(`  ${keys}`) && line.endsWith(`  ${label}`)),
      ).toBe(true);
    }
    expect(offered.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["Check now", "Open its URL", "This help", "Quit"]),
    );
  });

  it("should offer saving the response, which only the response panel's help names", () => {
    expect(paletteEntries(true, "save")).toEqual([
      { command: "trace", label: "Save the response to .probe/traces", keys: "w" },
    ]);
    expect(helpLines(true).some(({ text }) => /^ {2}w {7}Save the response$/.test(text))).toBe(
      true,
    );
  });

  it("should give each command once", () => {
    const commands = paletteEntries(true).map(({ command }) => command);

    expect(new Set(commands).size).toBe(commands.length);
  });

  it("should keep the commands that say the query, by what they do or by their word in the bar", () => {
    expect(paletteEntries(true, "ITS URL").map(({ command }) => command)).toEqual(["open"]);
    expect(paletteEntries(true, " copy ").map(({ command }) => command)).toEqual([
      "copy",
      "body",
      "copylog",
    ]);
    expect(paletteEntries(true, "zzz")).toEqual([]);
  });

  it("should write the keys in ASCII without unicode", () => {
    expect(paletteEntries(false, "detail")).toEqual([
      { command: "detail", label: "Service detail", keys: "enter" },
    ]);
  });

  it("should run from its key what it runs from the palette", () => {
    for (const { command, keys } of paletteEntries(true)) {
      expect(keyCommand(keys === "↵" ? "" : keys, keys === "↵")).toBe(command);
    }
    expect(keyCommand("j", false)).toBeUndefined();
    expect(keyCommand(":", false)).toBeUndefined();
    expect(keyCommand("", false)).toBeUndefined();
  });
});

describe("the key of the parameters", () => {
  it("should be in the bar only when the config declares parameters", () => {
    expect(helpBar("list", true, 200)).not.toContain("p parameters");
    expect(helpBar("list", true, 200, false, true)).toContain(
      "/ filter · p parameters · v variables · :",
    );
  });

  it("should leave the bar before the filter when the terminal is narrow", () => {
    expect(helpBar("list", true, 50, false, true)).toBe("↵ service · / filter · ? help · q quit");
  });
});

describe("helpColumns", () => {
  it("should put the sections side by side on 80 columns, in unicode and in ASCII", () => {
    for (const unicode of [true, false]) {
      const [left = [], right = []] = helpColumns(unicode, 80);

      expect(left[0]?.text).toBe("Move");
      expect(right.length).toBeGreaterThan(0);
      expect([...left, ...right]).toEqual(helpLines(unicode));
    }
  });

  it("should leave room for both columns and the gap", () => {
    const widest = (lines: { text: string }[]) => Math.max(...lines.map(({ text }) => text.length));
    const [left = [], right = []] = helpColumns(true, 80);

    expect(widest(left) + HELP_GAP + widest(right)).toBeLessThanOrEqual(80);
  });

  it("should stack the sections when two columns do not fit 40 columns", () => {
    expect(helpColumns(true, 40)).toEqual([helpLines(true)]);
    expect(helpColumns(false, 40)).toEqual([helpLines(false)]);
  });
});
