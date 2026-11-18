import { describe, expect, it } from "vitest";
import { gradient, hex, rgbTo256 } from "../src/tui/color";
import { parseInput } from "../src/tui/input";
import { columns, fill, resolveSizes } from "../src/tui/layout";
import { Screen } from "../src/tui/screen";
import { box, graph, meter, scrollTo, sparkline, table, tabs } from "../src/tui/widgets";
import { strWidth, truncate } from "../src/tui/width";

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips escape sequences
const withoutColors = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

describe("box", () => {
  it("draws a rounded frame with the title in the top border", () => {
    const screen = new Screen(16, 4, "none");
    const inner = box(screen, { x: 0, y: 0, w: 16, h: 4 }, { title: "cpu" });
    expect(inner).toEqual({ x: 1, y: 1, w: 14, h: 2 });
    expect(screen.toPlainText()).toBe(
      ["╭─┤cpu├────────╮", "│              │", "│              │", "╰──────────────╯"].join("\n"),
    );
  });

  it("does not overflow when narrower than its title", () => {
    const screen = new Screen(8, 3, "none");
    box(screen, { x: 0, y: 0, w: 8, h: 3 }, { title: "a very long title" });
    for (const line of screen.toPlainText().split("\n"))
      expect(strWidth(line)).toBeLessThanOrEqual(8);
  });
});

describe("screen diff", () => {
  it("sends only what changed", () => {
    const screen = new Screen(10, 2, "none");
    screen.text(0, 0, "hello");
    expect(screen.flush()).toContain("hello");
    screen.clear();
    screen.text(0, 0, "hello");
    expect(screen.flush()).toBe("");
    screen.clear();
    screen.text(0, 0, "help!");
    expect(withoutColors(screen.flush())).toBe("\x1b[1;4Hp!");
  });

  it("repaints everything after invalidate", () => {
    const screen = new Screen(5, 1, "none");
    screen.text(0, 0, "abc");
    screen.flush();
    screen.invalidate();
    expect(withoutColors(screen.flush())).toContain("abc");
  });

  it("clips wide characters cleanly", () => {
    expect(strWidth("日本")).toBe(4);
    expect(strWidth("é")).toBe(1);
    expect(truncate("abcdef", 4)).toBe("abc…");
    const screen = new Screen(5, 1, "none");
    screen.text(0, 0, "日本語");
    expect(screen.toPlainText()).toBe("日本");
  });

  it("keeps the cursor out of the last column wrap", () => {
    const screen = new Screen(3, 2, "none");
    screen.text(0, 0, "abc");
    screen.text(0, 1, "def");
    expect(withoutColors(screen.flush())).toBe("\x1b[1;1Habc\x1b[2;1Hdef");
  });
});

describe("layout", () => {
  it("fills the space exactly", () => {
    expect(resolveSizes(100, [10, "50%", fill(1), fill(1)])).toEqual([10, 50, 20, 20]);
    expect(resolveSizes(10, [8, 8])).toEqual([8, 2]);
    const [a, b] = columns({ x: 0, y: 0, w: 81, h: 5 }, [fill(), fill()], 1);
    expect((a?.w ?? 0) + (b?.w ?? 0) + 1).toBe(81);
  });
});

describe("widgets", () => {
  it("graph draws braille, a full value fills the column", () => {
    const screen = new Screen(2, 2, "none");
    graph(screen, { x: 0, y: 0, w: 2, h: 2 }, [0, 0, 10, 5], {
      max: 10,
      gradient: gradient([hex("#000"), hex("#fff")]),
    });
    expect(screen.toPlainText()).toBe(" ⡇\n ⣿");
  });

  it("meter fills in proportion", () => {
    const screen = new Screen(4, 1, "none");
    meter(screen, 0, 0, 4, 0.5, { gradient: gradient([hex("#000"), hex("#fff")]) });
    expect(screen.toPlainText()).toBe("■■■■");
    expect(withoutColors(sparkline([1, 8], 4, 8))).toBe("  ▂█");
  });

  it("table returns its body and scrolls", () => {
    const screen = new Screen(12, 4, "none");
    const body = table(
      screen,
      { x: 0, y: 0, w: 12, h: 4 },
      [{ title: "n", width: fill() }],
      [["a"], ["b"], ["c"]],
      {
        offset: 1,
      },
    );
    expect(body).toEqual({ x: 0, y: 1, w: 12, h: 3 });
    expect(screen.toPlainText().split("\n").slice(0, 3)).toEqual(["n", "b", "c"]);
    expect(scrollTo(5, 0, 3)).toBe(3);
    expect(scrollTo(0, 2, 3)).toBe(0);
  });

  it("tabs highlight the active one", () => {
    const screen = new Screen(20, 1, "none");
    expect(tabs(screen, 0, 0, ["all", "dev"], 1, { bold: true }, {})).toBe(12);
    expect(screen.toPlainText()).toBe(" all   dev");
  });
});

describe("input", () => {
  it("parses keys, modifiers and mouse", () => {
    const events = parseInput("q\x1b[A\x1b[1;5B\x03\x1b[<0;10;5M\x1b");
    expect(
      events.map((e) =>
        e.kind === "key" ? `${e.ctrl ? "C-" : ""}${e.name}` : `${e.action}@${e.x},${e.y}`,
      ),
    ).toEqual(["q", "up", "C-down", "C-c", "press@9,4", "escape"]);
  });

  it("parses SGR mouse press, release, drag and wheel", () => {
    const events = parseInput(
      "\x1b[<0;3;4M\x1b[<0;3;4m\x1b[<32;5;6M\x1b[<64;1;1M\x1b[<65;1;1M\x1b[<2;7;8M",
    );
    expect(events).toMatchObject([
      { action: "press", button: "left", x: 2, y: 3 },
      { action: "release", button: "left", x: 2, y: 3 },
      { action: "drag", x: 4, y: 5 },
      { action: "wheel-up" },
      { action: "wheel-down" },
      { action: "press", button: "right", x: 6, y: 7 },
    ]);
  });

  it("parses shift+tab, alt keys, SS3 arrows and pasted text", () => {
    expect(parseInput("\x1b[Z")).toMatchObject([{ name: "tab", shift: true }]);
    expect(parseInput("\x1bx")).toMatchObject([{ name: "x", alt: true }]);
    expect(parseInput("\x1bOB")).toMatchObject([{ name: "down" }]);
    expect(parseInput("jk")).toMatchObject([{ name: "j" }, { name: "k" }]);
  });
});

describe("colors", () => {
  it("converts and builds gradients", () => {
    expect(hex("#ff8000")).toEqual([255, 128, 0]);
    expect(hex("#fff")).toEqual([255, 255, 255]);
    expect(() => hex("nope")).toThrow();
    expect(rgbTo256([255, 0, 0])).toBe(196);
    expect(gradient([hex("#000000"), hex("#ffffff")], 3)[1]?.join()).toBe("128,128,128");
  });
});
