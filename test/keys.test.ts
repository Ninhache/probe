import type { Key } from "ink";
import { describe, expect, it } from "vitest";
import { splitKeys } from "../src/dashboard/keys";

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
