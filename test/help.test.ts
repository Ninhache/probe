import { describe, expect, it } from "vitest";
import completionCommand from "../src/commands/completion";
import { commands } from "../src/commands/registry";
import { renderCommandHelp, renderRootHelp } from "../src/ui/help";
import { stripStyles } from "../src/ui/terminal";

const ESC = "\u001b[";
const all = { ...commands, completion: completionCommand(commands) };
const args = {
  interval: { type: "string", valueHint: "s", description: "Dashboard refresh", default: "2" },
  once: { type: "boolean", description: "Check once and exit" },
} as const;

const root = (color: boolean, firstRun: boolean) =>
  renderRootHelp({
    version: "1.2.3",
    description: "Health checks for your local dev services",
    commands: all,
    args,
    color,
    firstRun,
  });

describe("root help", () => {
  it("groups the commands and lists the options", async () => {
    expect(await root(false, false)).toBe(
      [
        "probe 1.2.3 · health checks for your local dev services",
        "",
        "Usage: probe [command] [options]        probe alone opens the dashboard",
        "",
        "Daily",
        "  check [names]  Check that services respond",
        "  wait  [names]  Wait until services are up",
        "  open  <name>   Open a service in the browser",
        "  curl  <name>   Print the curl command of a service",
        "  ls             List services",
        "",
        "Set up",
        "  init · add · rm · env · var · sync · completion",
        "",
        "Troubleshoot",
        "  status · doctor · migrate",
        "",
        "Options",
        "  --interval <s>  Dashboard refresh (default 2)",
        "  --once          Check once and exit",
        "",
        "probe <command> --help for details",
        "",
      ].join("\n"),
    );
  });

  it("names every registered command", async () => {
    const text = await root(false, false);
    for (const name of Object.keys(all)) expect(text, name).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it("shows the first run line only outside a project", async () => {
    expect(await root(false, true)).toContain(
      "First run: cd into your project folder, then run `probe init`",
    );
    expect(await root(false, false)).not.toContain("First run");
  });

  it("has no trailing space and no colour when colour is off", async () => {
    const text = await root(false, true);
    expect(text).not.toContain(ESC);
    for (const line of text.split("\n")) expect(line).toBe(line.trimEnd());
  });

  it("colours command names and titles when colour is on, with the same words", async () => {
    const text = await root(true, true);
    expect(text).toContain(`${ESC}36mcheck${ESC}39m`);
    expect(text).toContain(`${ESC}1mDaily${ESC}22m`);
    expect(stripStyles(text)).toBe(await root(false, true));
  });
});

describe("command help", () => {
  it("lists the usage, every option and at most three examples", async () => {
    const text = await renderCommandHelp({ name: "check", command: commands.check, color: false });
    const lines = text.split("\n");
    expect(lines[0]).toBe("probe check · Check that services respond (all of them by default)");
    expect(text).toContain("Usage: probe check [names] [options]");
    for (const option of Object.keys(commands.check.args ?? {}))
      expect(text).toContain(`--${option}`);
    const examples = lines.slice(lines.indexOf("Examples") + 1).filter(Boolean);
    expect(examples.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(line).toBe(line.trimEnd());
  });

  it("lines up the flags under a short alias and keeps the defaults", async () => {
    const text = await renderCommandHelp({ name: "add", command: commands.add, color: false });
    expect(text).toContain("Usage: probe add <name> [options]");
    expect(text).toMatch(/\n {2}-p, --port <port> {2,}Port\n/);
    expect(text).toMatch(/\n {2} {4}--host <host> {2,}Host \(default: localhost\)\n/);
    expect(text.split("Examples\n")[1]?.trim().split("\n")).toHaveLength(3);
  });

  it("dims the default and writes no escape sequence with colour off", async () => {
    const on = await renderCommandHelp({ name: "add", command: commands.add, color: true });
    const off = await renderCommandHelp({ name: "add", command: commands.add, color: false });
    expect(on).toContain(`${ESC}2m(default:`);
    expect(off).not.toContain(ESC);
  });
});
