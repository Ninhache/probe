import { describe, expect, it } from "vitest";
import { nextChoice } from "../src/dashboard/choice";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH"];

describe("nextChoice", () => {
  it("should move to the next choice and wrap around", () => {
    expect(nextChoice(METHODS, "PATCH", 1)).toBe("GET");
    expect(nextChoice(METHODS, "GET", -1)).toBe("PATCH");
  });

  it("should read an empty value as the first choice", () => {
    expect(nextChoice(METHODS, "", 1)).toBe("HEAD");
  });

  it("should cycle through the choices a repeated letter starts", () => {
    expect(nextChoice(METHODS, "GET", "p")).toBe("POST");
    expect(nextChoice(METHODS, "POST", "P")).toBe("PUT");
    expect(nextChoice(METHODS, "PATCH", "p")).toBe("POST");
  });

  it("should keep the choice when no choice starts with the letter", () => {
    expect(nextChoice(METHODS, "PUT", "x")).toBe("PUT");
  });
});
