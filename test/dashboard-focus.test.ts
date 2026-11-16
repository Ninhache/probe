import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { watchFocus } from "../src/dashboard/focus";

const ESCAPE = String.fromCharCode(27);
const FOCUS_IN = `${ESCAPE}[I`;
const FOCUS_OUT = `${ESCAPE}[O`;

function terminal() {
  const input = new PassThrough();
  const read: string[] = [];
  // Ink reads the same way: what the watch sees must still reach it.
  input.on("readable", () => {
    for (let chunk = input.read(); chunk !== null; chunk = input.read()) read.push(String(chunk));
  });
  const written: string[] = [];
  const watch = watchFocus(input, { write: (text) => written.push(text) });
  const type = async (text: string) => {
    input.write(text);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { input, read, written, watch, type };
}

describe("watchFocus", () => {
  it("should ask the terminal for its focus, and know nothing until told", () => {
    const { written, watch } = terminal();

    expect(written).toEqual([`${ESCAPE}[?1004h`]);
    expect(watch.focused()).toBeUndefined();
  });

  it("should follow the focus, leaving every key to its reader", async () => {
    const { read, watch, type } = terminal();

    await type(FOCUS_OUT);
    expect(watch.focused()).toBe(false);
    await type(`j${FOCUS_IN}k`);
    expect(watch.focused()).toBe(true);
    await type(`${FOCUS_IN}${FOCUS_OUT}`);
    expect(watch.focused()).toBe(false);
    await type(`${ESCAPE}[A`);
    expect(watch.focused()).toBe(false);

    expect(read.join("")).toBe(`${FOCUS_OUT}j${FOCUS_IN}k${FOCUS_IN}${FOCUS_OUT}${ESCAPE}[A`);
  });

  it("should turn the reports off once, and stop listening", async () => {
    const { input, written, watch, type } = terminal();

    watch.stop();
    watch.stop();
    await type(FOCUS_OUT);

    expect(written).toEqual([`${ESCAPE}[?1004h`, `${ESCAPE}[?1004l`]);
    expect(watch.focused()).toBeUndefined();
    expect(input.listenerCount("data")).toBe(0);
  });
});
