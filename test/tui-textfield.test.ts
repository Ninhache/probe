import { describe, expect, it } from "vitest";
import { type InputEvent, type Key, parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import {
  drawField,
  fieldKey,
  fieldValue,
  insertText,
  renderField,
  type TextField,
  textField,
} from "../src/tui/textfield";

/** Feed raw terminal input the way the app does. */
const type = (f: TextField, data: string): TextField =>
  parseInput(data).reduce((acc, e: InputEvent) => (e.kind === "key" ? fieldKey(acc, e) : acc), f);
const text = (f: TextField, width: number) => renderField(f, width).cells.join("");
const LEFT = "\x1b[D";

describe("text field editing", () => {
  it("inserts at the caret and moves it", () => {
    let f = type(textField(), "helo");
    f = type(f, `${LEFT}l`);
    expect(fieldValue(f)).toBe("hello");
    expect(f.cursor).toBe(4);
  });

  it("deletes with backspace and delete", () => {
    let f = type(textField("abcd"), `${LEFT}${LEFT}\x7f`);
    expect(fieldValue(f)).toBe("acd");
    f = type(f, "\x1b[3~");
    expect(fieldValue(f)).toBe("ad");
    expect(fieldValue(type(textField(), "\x7f"))).toBe("");
  });

  it("goes home and end", () => {
    expect(type(textField("abc"), "\x1b[H").cursor).toBe(0);
    expect(type(textField("abc"), "\x1b[H\x1b[F").cursor).toBe(3);
    expect(type(textField("abc"), "\x01").cursor).toBe(0);
    expect(type(textField("abc"), "\x01\x05").cursor).toBe(3);
  });

  it("jumps by word", () => {
    const f = textField("one two  three");
    expect(type(f, "\x1b[1;5D").cursor).toBe(9);
    expect(type(f, "\x1b[1;5D\x1b[1;5D").cursor).toBe(4);
    expect(type(textField("one two"), "\x1b[H\x1b[1;5C").cursor).toBe(3);
    expect(fieldValue(type(f, "\x17"))).toBe("one two  ");
    expect(fieldValue(type(f, "\x15"))).toBe("");
    expect(fieldValue(type(textField("one two"), "\x1b[H\x0b"))).toBe("");
  });

  it("takes pasted text, dropping control characters", () => {
    expect(fieldValue(insertText(textField("ab"), "x\ny\x1b"))).toBe("abxy");
    expect(fieldValue(type(textField(), "pasted text"))).toBe("pasted text");
  });

  it("leaves Enter, Esc and arrows up/down to the caller", () => {
    const f = textField("a");
    for (const data of ["\r", "\x1b", "\x1b[A", "\x1b[B", "\t"]) expect(type(f, data)).toBe(f);
  });

  it("edits wide characters and emoji as one unit", () => {
    const f = type(textField("日本"), "\x7f");
    expect(fieldValue(f)).toBe("日");
    expect(fieldValue(type(textField("a👍🏽"), "\x7f"))).toBe("a");
  });
});

describe("text field rendering", () => {
  it("scrolls horizontally to keep the caret visible", () => {
    let f = textField("abcdefghij");
    expect(text(f, 5)).toBe("ghij");
    expect(renderField(f, 5).caret).toBe(4);
    f = renderField(f, 5).state;
    f = type(f, "\x1b[H");
    expect(text(f, 5)).toBe("abcde");
    expect(renderField(f, 5).state.offset).toBe(0);
  });

  it("counts wide characters as two columns", () => {
    const view = renderField(textField("日本語"), 5);
    expect(view.cells.join("")).toBe("本語");
    expect(view.cells).toEqual(["本", "", "語", ""]);
    expect(view.caret).toBe(4);
  });

  it("masks secret values", () => {
    const f = textField("hunter2", "•");
    expect(text(f, 20)).toBe("•••••••");
    expect(fieldValue(f)).toBe("hunter2");
  });

  it("draws the caret as an inverse cell", () => {
    const screen = new Screen(10, 1, "truecolor");
    drawField(screen, 2, 0, 6, type(textField("abc"), LEFT), {});
    expect(screen.toPlainText()).toBe("  abc");
    const bare = new Screen(10, 1, "truecolor");
    drawField(bare, 2, 0, 6, textField("abc"), {}, false);
    expect(screen.flush()).not.toBe(bare.flush());
  });
});

describe("types", () => {
  it("accepts engine keys", () => {
    const k: Key = { kind: "key", name: "x", ctrl: false, alt: false, shift: false, raw: "x" };
    expect(fieldValue(fieldKey(textField(), k))).toBe("x");
  });
});
