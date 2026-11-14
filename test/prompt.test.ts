import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ask as askText, confirm, type Question } from "../src/ui/prompt";

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

/** Asks for text on fake streams, typing each entry of `lines` when its marker is drawn. */
async function type(question: Question, steps: [marker: string, keys: string][]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = "";
  output.on("data", (chunk: Buffer) => {
    screen += chunk.toString();
    const next = steps[0];
    if (!next || !screen.includes(next[0])) return;
    steps.shift();
    setImmediate(() => input.write(next[1]));
  });
  return askText("Port", question, { input, output });
}

describe("ask", () => {
  it("should return what was typed", async () => {
    expect(await type({}, [["Port", `3000${ENTER}`]])).toBe("3000");
  });

  it("should return the default when Enter is pressed alone", async () => {
    const refuseAll = () => "never valid";

    expect(await type({ defaultValue: "/", validate: refuseAll }, [["Port", ENTER]])).toBe("/");
  });

  it("should ask again when the answer is refused", async () => {
    const validate = (answer: string) => (answer === "abc" ? "not a number" : undefined);

    const answer = await type({ validate }, [
      ["Port", `abc${ENTER}`],
      ["not a number", `\u007f\u007f\u007f80${ENTER}`],
    ]);

    expect(answer).toBe("80");
  });

  it("should return null when cancelled", async () => {
    expect(await type({}, [["Port", CTRL_C]])).toBeNull();
  });
});
