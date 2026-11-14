import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { confirm } from "../src/ui/prompt";

const ENTER = "\r";
const CTRL_C = "\u0003";

/** Asks on fake streams, types `keys` once the question is drawn, returns the answer and the screen. */
async function ask(keys: string): Promise<{ answer: boolean; screen: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = "";
  let typed = false;
  output.on("data", (chunk: Buffer) => {
    screen += chunk.toString();
    if (typed || !screen.includes("Remove api?")) return;
    typed = true;
    // The question is drawn before its keys are listened to.
    setImmediate(() => input.write(keys));
  });
  const answer = await confirm("Remove api?", { input, output });
  return { answer, screen };
}

describe("confirm", () => {
  it("should return true when yes is chosen", async () => {
    expect((await ask(`y${ENTER}`)).answer).toBe(true);
  });

  it("should return false when Enter is pressed alone", async () => {
    expect((await ask(ENTER)).answer).toBe(false);
  });

  it("should return false when no is chosen", async () => {
    expect((await ask(`n${ENTER}`)).answer).toBe(false);
  });

  it("should return false when the question is cancelled", async () => {
    expect((await ask(CTRL_C)).answer).toBe(false);
  });
});
