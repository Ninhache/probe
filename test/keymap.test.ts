import { describe, expect, it } from "vitest";
import { helpBar, helpLines } from "../src/dashboard/keymap";

describe("helpBar", () => {
  it("should show the keys of the list when there is room", () => {
    expect(helpBar("list", true, 100)).toBe(
      "↑↓ jk move · r refresh · ↵ service · o options · ? help · q quit",
    );
  });

  it("should show other keys in a panel", () => {
    expect(helpBar("panel", true, 100)).toBe(
      "↑↓ jk move · ←→ hl change · esc close · ? help · q quit",
    );
  });

  it.each([60, 50, 40, 30])("should stay on one line of %i columns", (columns) => {
    for (const screen of ["list", "panel", "help"] as const) {
      expect(helpBar(screen, true, columns).length).toBeLessThanOrEqual(columns);
    }
  });

  it("should give up moving first when the line is too wide", () => {
    expect(helpBar("list", true, 60)).toBe("r refresh · ↵ service · o options · ? help · q quit");
  });

  it("should keep the keys that lead out when nothing else fits", () => {
    expect(helpBar("list", true, 5)).toBe("? help · q quit");
    expect(helpBar("panel", true, 5)).toBe("esc close · ? help · q quit");
  });

  it("should write the keys in ASCII without unicode", () => {
    expect(helpBar("panel", false, 100)).toBe("jk move - hl change - esc close - ? help - q quit");
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

    expect(headings.map(({ text }) => text)).toEqual(["List", "Panels", "Everywhere"]);
  });
});
