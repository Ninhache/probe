import { describe, expect, it } from "vitest";
import { closest, typoDistance } from "../src/suggest";

const COMMANDS = ["init", "add", "rm", "ls", "check", "wait", "status", "sync", "migrate"];

describe("typoDistance", () => {
  it.each([
    ["check", "check", 0],
    ["chek", "check", 1],
    ["checks", "check", 1],
    ["chrck", "check", 1],
    ["chekc", "check", 1],
    ["statsu", "status", 1],
    ["cehk", "check", 2],
    ["", "ls", 2],
  ])("counts %j to %j as %i", (typed, command, distance) => {
    expect(typoDistance(typed, command)).toBe(distance);
  });
});

describe("closest", () => {
  it.each([
    ["chek", "check"],
    ["chekc", "check"],
    ["cehk", "check"],
    ["stats", "status"],
    ["migrat", "migrate"],
    ["Check", "check"],
    ["sl", "ls"],
    ["ad", "add"],
    ["snyc", "sync"],
  ])("suggests for %j the command %j", (typed, command) => {
    expect(closest(typed, COMMANDS)).toBe(command);
  });

  it.each(["nope", "deploy", "x", "zz", "xyz", ""])("suggests nothing for %j", (typed) => {
    expect(closest(typed, COMMANDS)).toBeUndefined();
  });

  it("prefers the closest candidate, then the first one", () => {
    expect(closest("wai", ["wait", "wail"])).toBe("wait");
    expect(closest("syncs", ["status", "sync"])).toBe("sync");
  });
});
