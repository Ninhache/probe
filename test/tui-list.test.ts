import { describe, expect, it } from "vitest";
import type { InputEvent } from "../src/tui/input";
import { clampList, listKey, listMouse, listState, renderList } from "../src/tui/list";
import { Screen } from "../src/tui/screen";

const key = (name: string): InputEvent => ({
  kind: "key",
  name,
  ctrl: false,
  alt: false,
  shift: false,
  raw: name,
});
const mouse = (action: "press" | "wheel-up" | "wheel-down", x = 0, y = 0): InputEvent => ({
  kind: "mouse",
  action,
  button: action === "press" ? "left" : "none",
  x,
  y,
  raw: "",
});
const geometry = { count: 20, body: { x: 2, y: 3, w: 10, h: 5 } };

describe("list widget", () => {
  it("moves the selection and scrolls to keep it visible", () => {
    let s = listState();
    for (let i = 0; i < 6; i++) s = listKey(s, key("down"), geometry);
    expect(s).toEqual({ selected: 6, offset: 2 });
    s = listKey(s, key("up"), geometry);
    expect(s.selected).toBe(5);
    expect(listKey(listState(), key("up"), geometry).selected).toBe(0);
  });

  it("pages by a screenful less one row", () => {
    const s = listKey(listState(), key("pagedown"), geometry);
    expect(s.selected).toBe(4);
    expect(listKey(s, key("pageup"), geometry).selected).toBe(0);
  });

  it("jumps to the ends", () => {
    const end = listKey(listState(), key("end"), geometry);
    expect(end).toEqual({ selected: 19, offset: 15 });
    expect(listKey(end, key("home"), geometry)).toEqual({ selected: 0, offset: 0 });
  });

  it("scrolls with the wheel and clamps at the ends", () => {
    expect(listMouse(listState(), mouse("wheel-down"), geometry).selected).toBe(3);
    expect(listMouse(listState(), mouse("wheel-up"), geometry).selected).toBe(0);
  });

  it("selects the clicked row, ignoring clicks outside the body or past the last row", () => {
    const scrolled = { selected: 7, offset: 4 };
    expect(listMouse(scrolled, mouse("press", 3, 5), geometry).selected).toBe(6);
    expect(listMouse(scrolled, mouse("press", 0, 5), geometry)).toBe(scrolled);
    expect(listMouse(scrolled, mouse("press", 3, 9), geometry)).toBe(scrolled);
    const short = { count: 2, body: geometry.body };
    expect(listMouse(listState(), mouse("press", 3, 6), short).selected).toBe(0);
  });

  it("survives an empty list and shrinking content", () => {
    expect(listKey(listState(3), key("down"), { count: 0, body: geometry.body })).toEqual({
      selected: 0,
      offset: 0,
    });
    expect(
      clampList({ selected: 15, offset: 11 }, { count: 4, body: geometry.body }).selected,
    ).toBe(3);
  });

  it("draws the visible rows from the offset", () => {
    const screen = new Screen(12, 3, "truecolor");
    renderList(screen, { x: 0, y: 0, w: 12, h: 3 }, ["a", "b", "c", "d", "e"], {
      selected: 3,
      offset: 2,
    });
    expect(screen.toPlainText()).toBe("c\nd\ne");
  });
});
