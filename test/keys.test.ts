import { describe, expect, it } from "vitest";
import { fromEngineKey } from "../src/dashboard/keys";
import type { Key as EngineKey } from "../src/tui/input";

describe("fromEngineKey", () => {
  const press = (name: string, extra: Partial<EngineKey> = {}): EngineKey => ({
    kind: "key",
    name,
    ctrl: false,
    alt: false,
    shift: false,
    raw: name,
    ...extra,
  });

  it("maps named keys to the keystrokes the forms read", () => {
    expect(fromEngineKey(press("enter"))).toEqual({ input: "", key: "return" });
    expect(fromEngineKey(press("up"))).toEqual({ input: "", key: "up" });
    expect(fromEngineKey(press("escape"))).toEqual({ input: "", key: "escape" });
    expect(fromEngineKey(press("u", { ctrl: true }))).toEqual({ input: "", key: "clear" });
  });

  it("keeps the typed character, including space and capitals", () => {
    expect(fromEngineKey(press("j"))).toEqual({ input: "j" });
    expect(fromEngineKey(press("z", { raw: "Z", shift: true }))).toEqual({ input: "Z" });
    expect(fromEngineKey(press("space", { raw: " " }))).toEqual({ input: " " });
  });

  it("gives no character for a chord", () => {
    expect(fromEngineKey(press("a", { ctrl: true })).input).toBe("");
  });
});
