import { describe, expect, it } from "vitest";
import type { InputEvent } from "../src/tui/input";
import { type Modal, ModalStack, modalRect } from "../src/tui/modal";
import { Screen } from "../src/tui/screen";

const key = (name: string): InputEvent => ({
  kind: "key",
  name,
  ctrl: false,
  alt: false,
  shift: false,
  raw: name,
});
const area = { x: 0, y: 0, w: 30, h: 10 };
const modal = (title: string, text: string, size = { w: 14, h: 5 }): Modal => ({
  title,
  size,
  draw: (screen, inner) => void screen.text(inner.x, inner.y, text),
});
const draw = (stack: ModalStack, background = "") => {
  const screen = new Screen(area.w, area.h, "truecolor");
  if (background) screen.fill(area, background);
  stack.draw(screen, area);
  return screen.toPlainText().split("\n");
};

describe("modal", () => {
  it("is a rounded box with the title in its top border, centered", () => {
    const stack = new ModalStack();
    stack.push(modal("help", "hello"));
    const rows = draw(stack);
    expect(rows[2]).toBe(`${" ".repeat(8)}╭─┤help├─────╮`);
    expect(rows[3]).toBe(`${" ".repeat(8)}│hello       │`);
    expect(rows[6]).toBe(`${" ".repeat(8)}╰────────────╯`);
    expect(modalRect(area, { w: 14, h: 5 })).toEqual({ x: 8, y: 2, w: 14, h: 5 });
  });

  it("keeps the background around the box", () => {
    const stack = new ModalStack();
    stack.push(modal("m", "x"));
    const rows = draw(stack, ".");
    expect(rows[0]).toBe(".".repeat(30));
    expect(rows[3]?.startsWith(`${".".repeat(8)}│x`)).toBe(true);
  });

  it("shrinks to fit a small screen", () => {
    expect(modalRect({ x: 0, y: 0, w: 10, h: 4 }, { w: 40, h: 20 })).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 4,
    });
  });

  it("gives the keyboard to the topmost modal and Esc closes only that one", () => {
    const stack = new ModalStack();
    const seen: string[] = [];
    const listening = (title: string): Modal => ({
      ...modal(title, title),
      onEvent: (event) => {
        if (event.kind === "key") seen.push(`${title}:${event.name}`);
        return event.kind === "key" && event.name === "x";
      },
    });
    stack.push(listening("a"));
    stack.push(listening("b"));
    expect(stack.handle(key("x"))).toBe(true);
    expect(stack.depth).toBe(2);
    stack.handle(key("escape"));
    expect(stack.depth).toBe(1);
    stack.handle(key("q"));
    expect(seen).toEqual(["b:x", "b:escape", "a:q"]);
    stack.handle(key("escape"));
    expect(stack.depth).toBe(0);
    expect(stack.handle(key("q"))).toBe(false);
  });

  it("stacks: the later modal covers the earlier one", () => {
    const stack = new ModalStack();
    stack.push(modal("big", "under", { w: 20, h: 7 }));
    stack.push(modal("small", "over", { w: 12, h: 3 }));
    const rows = draw(stack);
    expect(rows.join("\n")).toContain("small");
    expect(rows.join("\n")).toContain("big");
    expect(rows.join("\n")).toContain("over");
    expect(rows[2]).toBe("     │under             │");
    expect(rows[3]).toBe("     │   ╭─┤small├──╮   │");
  });
});
