import { describe, expect, it } from "vitest";
import { helpColumns } from "../src/dashboard/keymap";
import { helpModal, helpRows, searchRows } from "../src/dashboard/native/help";
import { parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const W = 120;
const H = 40;
const AREA = { x: 0, y: 0, w: W, h: H };

function open(area = AREA, current: Parameters<typeof helpModal>[2] = "list") {
  const modal = helpModal(area, false, current);
  const screen = () => {
    const out = new Screen(area.w, area.h, "none");
    const w = Math.min(modal.size.w, area.w);
    const h = Math.min(modal.size.h, area.h);
    const inner = { x: 1, y: 1, w: w - 2, h: h - 2 };
    modal.draw(out, inner);
    return out.toPlainText();
  };
  const inner = {
    x: 1,
    y: 1,
    w: Math.min(modal.size.w, area.w) - 2,
    h: Math.min(modal.size.h, area.h) - 2,
  };
  const press = (text: string) => {
    let last: ReturnType<NonNullable<typeof modal.onEvent>> | undefined;
    for (const event of parseInput(text)) last = modal.onEvent?.(event, inner);
    return last;
  };
  return { modal, screen, press };
}

const ESC = "\x1b";

describe("the help search", () => {
  it("should show every line and a prompt before anything is typed", () => {
    const { screen, modal } = open();

    expect(screen()).toContain("search:");
    expect(screen()).toContain("Palette");
    expect(modal.footer).toBe("type to search · esc close");
  });

  it("should keep only the lines whose key or description match, case-insensitively", () => {
    const { screen, press } = open();

    press("FILTER");

    const frame = screen();
    expect(frame).toContain("Filter by name");
    expect(frame).not.toContain("Undo last change");
  });

  it("should match the keys too, written either way", () => {
    const rows = (query: string) => searchRows(query, false).map(({ cells }) => cells[0]?.text);

    expect(rows("enter").some((text) => text?.includes("↵"))).toBe(true);
    expect(rows("↵").length).toBeGreaterThan(0);
  });

  it("should keep the heading of a section that has a match, and drop the others", () => {
    const texts = searchRows("filter by name", false).map(({ cells }) => cells[0]?.text);

    expect(texts[0]).toBe("Move");
    expect(texts).toHaveLength(2);
  });

  it("should say when nothing matches", () => {
    const { screen, press } = open();

    press("zzzz");

    expect(screen()).toContain('No key matches "zzzz"');
  });

  it("should type q and the other letters, and never close or quit on them", () => {
    const { screen, press } = open();

    expect(press("q")).toBe(true);
    expect(press("j")).toBe(true);

    expect(screen()).toContain("qj");
  });

  it("should edit the query with backspace", () => {
    const { screen, press } = open();
    press("zzzz");

    press("\x7f\x7f\x7f\x7f");

    expect(screen()).toContain("Palette");
  });

  it("should clear a query on esc, and close only when the query is empty", () => {
    const { screen, press, modal } = open();
    press("undo");
    expect(modal.footer).toBe("esc clear");

    expect(press(ESC)).toBe(true);
    expect(screen()).toContain("Palette");
    expect(modal.footer).toBe("type to search · esc close");
    expect(press(ESC)).toBe(false);
  });

  it("should still close on ?", () => {
    const { press } = open();

    expect(press("?")).toBe("close");
  });

  it("should scroll with the arrows without touching the query", () => {
    const { press, screen } = open({ x: 0, y: 0, w: W, h: 12 });

    press(`${ESC}[B${ESC}[B${ESC}[6~`);

    expect(screen()).toContain("search:");
    expect(screen()).not.toContain("search: j");
  });

  it("should not let a typing modal be quit from", () => {
    expect(open().modal.typing).toBe(true);
  });
});

describe("the help by screen", () => {
  const TAB = "\t";

  it("should put the keys of the current screen first, with the rest folded", () => {
    const { screen } = open(AREA, "response");

    const frame = screen();
    expect(frame).toContain("Copy the response");
    expect(frame).toContain("all keys (Tab)");
    expect(frame).not.toContain("Filter by name");
    expect(frame.indexOf("Copy the response")).toBeLessThan(frame.indexOf("all keys (Tab)"));
  });

  it("should show the list keys on the list, and not the ones of the response", () => {
    const frame = open(AREA, "list").screen();

    expect(frame).toContain("Palette");
    expect(frame).not.toContain("Copy the response\n");
    expect(frame).not.toContain("Back to the detail");
  });

  it("should unfold every other key under the rule on Tab, and fold them back on a second Tab", () => {
    const { screen, press } = open(AREA, "response");

    press(TAB);

    const frame = screen();
    expect(frame).toContain("Filter by name");
    expect(frame.indexOf("all keys (Tab)")).toBeLessThan(frame.indexOf("Filter by name"));
    press(TAB);
    expect(screen()).not.toContain("Filter by name");
  });

  it("should search the keys of every screen while they are folded", () => {
    const { screen, press } = open(AREA, "response");

    press("filter by");

    expect(screen()).toContain("Filter by name");
    expect(screen()).not.toContain("all keys (Tab)");
  });

  it("should not type a tab into the query, nor unfold while searching", () => {
    const { screen, press } = open(AREA, "response");
    press("scroll");

    press(TAB);

    expect(screen()).toContain("search: scroll");
    expect(screen()).not.toContain("Filter by name");
  });

  it("should list a key in the current keys or in the rest, never in both", () => {
    const ids = (part: "current" | "rest") =>
      helpColumns(true, 200, false, "detail", part)
        .flat()
        .filter(({ heading }) => !heading)
        .map(({ id }) => id);

    const current = ids("current");
    expect(current.length).toBeGreaterThan(0);
    expect(ids("rest").filter((id) => current.includes(id))).toEqual([]);
  });

  it.each([false, true])(
    "should fit the keys of the list in 10 rows, and the folded help in 80x24 (grid: %s)",
    (grid) => {
      const area = { x: 0, y: 0, w: 80, h: 24 };
      const modal = helpModal(area, grid, "list");

      expect(helpRows(80 - 8 - 4, grid, "list", "current").length).toBeLessThanOrEqual(10);
      expect(modal.size.h).toBeLessThanOrEqual(area.h);
      expect(modal.size.w).toBeLessThanOrEqual(area.w);
    },
  );
});
