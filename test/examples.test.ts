import { type ArgsDef, parseArgs } from "citty";
import { describe, expect, it } from "vitest";
import add from "../src/commands/add";
import check from "../src/commands/check";
import curl from "../src/commands/curl";
import init from "../src/commands/init";
import ls from "../src/commands/ls";
import migrate from "../src/commands/migrate";
import open from "../src/commands/open";
import rm from "../src/commands/rm";
import status from "../src/commands/status";
import sync from "../src/commands/sync";
import wait from "../src/commands/wait";
import { EXAMPLES, formatExamples } from "../src/ui/examples";

const COMMANDS: Record<string, { args?: unknown }> = {
  init,
  add,
  rm,
  ls,
  check,
  wait,
  open,
  curl,
  status,
  sync,
  migrate,
};
const HELP_WIDTH = 80;

/** Words of the probe command of an example: what comes before a shell operator. */
function probeWords(command: string): string[] {
  const words = command.split(" ");
  const operator = words.findIndex((word) => ["&&", "||", "|", ";"].includes(word));
  return operator === -1 ? words : words.slice(0, operator);
}

function optionNames(args: ArgsDef): Set<string> {
  const names = new Set<string>();
  for (const [name, arg] of Object.entries(args)) {
    if (arg.type === "positional") continue;
    names.add(`--${name}`);
    for (const alias of [(arg as { alias?: string | string[] }).alias ?? []].flat())
      names.add(`-${alias}`);
  }
  return names;
}

describe("help examples", () => {
  it.each(["probe", ...Object.keys(COMMANDS)])("has at least one example for %s", (name) => {
    expect(EXAMPLES[name]?.length).toBeGreaterThan(0);
  });

  it("has no example for a command that does not exist", () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(["probe", ...Object.keys(COMMANDS)].sort());
  });

  const all = Object.entries(EXAMPLES).flatMap(([name, examples]) =>
    examples.map((example) => [name, example.command] as const),
  );

  it.each(all)("in the help of %s, `%s` is a valid command line", (name, command) => {
    const [binary, ...words] = probeWords(command);
    expect(binary).toBe("probe");
    const [commandName, ...rawArgs] = words;
    if (commandName === undefined) return;
    if (name !== "probe") expect(commandName).toBe(name);
    const definition = COMMANDS[commandName];
    expect(definition, `unknown command ${commandName}`).toBeDefined();
    const args = (definition?.args ?? {}) as ArgsDef;
    const known = optionNames(args);

    for (const option of rawArgs.filter((word) => word.startsWith("-"))) {
      expect(known, `${option} is not an option of ${commandName}`).toContain(option);
    }
    expect(() => parseArgs(rawArgs, args)).not.toThrow();
  });

  it("rejects a command line that misses a required option, so the check above means something", () => {
    expect(() => parseArgs(["api"], (add.args ?? {}) as ArgsDef)).toThrow();
  });

  it.each(Object.keys(EXAMPLES))("fits the examples of %s in 80 columns", (name) => {
    for (const line of formatExamples(name, false).split("\n")) {
      expect(line.length, line).toBeLessThanOrEqual(HELP_WIDTH);
    }
  });

  it("styles the section only when colours are on", () => {
    expect(formatExamples("check", false)).not.toContain("\u001b");
    expect(formatExamples("check", true)).toContain("\u001b[36mprobe check");
    expect(formatExamples("check", false).split("\n").slice(0, 3)).toEqual([
      "EXAMPLES",
      "",
      "  probe check               Check every service",
    ]);
  });

  it("renders nothing for a command without examples", () => {
    expect(formatExamples("nope", false)).toBe("");
  });
});
