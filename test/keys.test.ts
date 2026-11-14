import type { Key } from "ink";
import { describe, expect, it } from "vitest";
import { splitKeys, typedCharacter } from "../src/dashboard/keys";

const ESCAPE = String.fromCharCode(27);
const none = {} as Key;

describe("splitKeys", () => {
  it("gives a single character as one press", () => {
    expect(splitKeys("j", none)).toEqual([{ input: "j" }]);
  });

  it("gives a named key as one press", () => {
    expect(splitKeys("", { downArrow: true } as Key)).toEqual([{ input: "", key: "down" }]);
    expect(splitKeys("\r", { return: true } as Key)).toEqual([{ input: "\r", key: "return" }]);
  });

  it("gives backspace and tab as named keys, alone or inside keys read together", () => {
    expect(splitKeys("", { delete: true } as Key)).toEqual([{ input: "", key: "backspace" }]);
    expect(splitKeys("", { backspace: true } as Key)).toEqual([{ input: "", key: "backspace" }]);
    expect(splitKeys("\t", { tab: true } as Key)).toEqual([{ input: "\t", key: "tab" }]);
    expect(splitKeys(`a${String.fromCharCode(127)}\tb`, none)).toEqual([
      { input: "a" },
      { input: "", key: "backspace" },
      { input: "", key: "tab" },
      { input: "b" },
    ]);
  });

  it("gives one press per character of keys read together, in order", () => {
    expect(splitKeys("llq", none)).toEqual([{ input: "l" }, { input: "l" }, { input: "q" }]);
  });

  it("recognises enter, escape and arrows inside keys read together", () => {
    expect(splitKeys(`j\r${ESCAPE}[B${ESCAPE}[Cx${ESCAPE}`, none)).toEqual([
      { input: "j" },
      { input: "", key: "return" },
      { input: "", key: "down" },
      { input: "", key: "right" },
      { input: "x" },
      { input: "", key: "escape" },
    ]);
  });
});

describe("typedCharacter", () => {
  it("should give the character of a key that types one", () => {
    expect(typedCharacter({ input: "q" })).toBe("q");
    expect(typedCharacter({ input: "/" })).toBe("/");
  });

  it("should give nothing for a named key or a control character", () => {
    expect(typedCharacter({ input: "\r", key: "return" })).toBeUndefined();
    expect(typedCharacter({ input: String.fromCharCode(3) })).toBeUndefined();
    expect(typedCharacter({ input: "" })).toBeUndefined();
  });
});
