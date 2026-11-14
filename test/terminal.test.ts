import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { configSchemaV1 } from "../src/config/schema";
import { formatCheckResults, formatServices } from "../src/ui/report";
import { detectTerminal, isInteractive, stripStyles, truncate } from "../src/ui/terminal";

const ESC = String.fromCharCode(27);
const tty = { isTTY: true, columns: 120 };
const utf8 = { LANG: "en_US.UTF-8" };

describe("detectTerminal", () => {
  it("turns everything off when the stream is not a terminal", () => {
    const env = { ...utf8, TERM: "xterm-kitty", TERM_PROGRAM: "iTerm.app" };
    expect(detectTerminal({ isTTY: false, columns: 80 }, env)).toEqual({
      isTTY: false,
      color: false,
      columns: undefined,
      hyperlinks: false,
      unicode: false,
    });
  });

  it("colours a terminal unless NO_COLOR is set or TERM is dumb", () => {
    expect(detectTerminal(tty, {}).color).toBe(true);
    expect(detectTerminal(tty, { NO_COLOR: "1" }).color).toBe(false);
    expect(detectTerminal(tty, { NO_COLOR: "" }).color).toBe(true);
    expect(detectTerminal(tty, { TERM: "dumb" })).toMatchObject({
      color: false,
      hyperlinks: false,
      unicode: false,
    });
  });

  it("keeps hyperlinks when only colours are refused", () => {
    const env = { NO_COLOR: "1", TERM_PROGRAM: "ghostty" };
    expect(detectTerminal(tty, env)).toMatchObject({ color: false, hyperlinks: true });
  });

  it("reports the width only when it is known", () => {
    expect(detectTerminal(tty, {}).columns).toBe(120);
    expect(detectTerminal({ isTTY: true }, {})).toMatchObject({
      columns: undefined,
    });
    expect(detectTerminal({ isTTY: true, columns: 0 }, {}).columns).toBeUndefined();
  });

  it.each([
    [{ TERM_PROGRAM: "Apple_Terminal", TERM_PROGRAM_VERSION: "455" }, false],
    [{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.14" }, true],
    [{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.0.15" }, false],
    [{ TERM_PROGRAM: "iTerm.app" }, false],
    [{ TERM_PROGRAM: "vscode", TERM_PROGRAM_VERSION: "1.71.0" }, false],
    [{ TERM_PROGRAM: "vscode", TERM_PROGRAM_VERSION: "1.96.2" }, true],
    [{ TERM_PROGRAM: "ghostty" }, true],
    [{ TERM: "xterm-kitty" }, true],
    [{ TERM: "alacritty" }, true],
    [{ VTE_VERSION: "7600" }, true],
    [{ VTE_VERSION: "4800" }, false],
    [{ TERM: "xterm-256color" }, false],
    [{ TERM: "tmux-256color", TERM_PROGRAM: "ghostty" }, false],
    [{ TMUX: "/tmp/tmux-1000/default,1,0", TERM: "xterm-kitty" }, false],
  ])("hyperlinks for %o: %s", (env, expected) => {
    expect(detectTerminal(tty, env).hyperlinks).toBe(expected);
  });

  it("reads unicode support from the locale", () => {
    expect(detectTerminal(tty, utf8).unicode).toBe(true);
    expect(detectTerminal(tty, { LANG: "C" }).unicode).toBe(false);
    expect(detectTerminal(tty, { LANG: "C", LC_ALL: "fr_FR.utf8" }).unicode).toBe(true);
    expect(detectTerminal(tty, { ...utf8, TERM: "linux" }).unicode).toBe(false);
    expect(detectTerminal(tty, {}).unicode).toBe(false);
  });
});

describe("isInteractive", () => {
  it("needs a terminal on both ends, outside CI", () => {
    expect(isInteractive(tty, tty, {})).toBe(true);
    expect(isInteractive({ isTTY: false }, tty, {})).toBe(false);
    expect(isInteractive(tty, { isTTY: false }, {})).toBe(false);
    expect(isInteractive(tty, tty, { CI: "true" })).toBe(false);
    expect(isInteractive(tty, tty, { TERM: "dumb" })).toBe(false);
  });
});

describe("truncate and stripStyles", () => {
  it("cuts with an ellipsis, within the width", () => {
    expect(truncate("abcdef", 6)).toBe("abcdef");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abcdef", 1)).toBe("…");
    expect(truncate("a😀bcd", 3)).toBe("a😀…");
  });

  it("removes colour sequences", () => {
    expect(
      stripStyles(`${ESC}[4m${ESC}[1mUSAGE${ESC}[22m${ESC}[24m ${ESC}[36mprobe${ESC}[39m`),
    ).toBe("USAGE probe");
  });
});

const results: CheckResult[] = [
  {
    name: "api",
    type: "http",
    target: "http://127.0.0.1:4101/health",
    ok: true,
    status: 200,
    latencyMs: 47,
  },
  {
    name: "a-rather-long-service-name",
    type: "http",
    target: "http://localhost:3000/",
    ok: false,
    latencyMs: 3,
    error: "connection refused, nothing listens on this port",
  },
];
const config = configSchemaV1.parse({
  schemaVersion: 1,
  services: {
    api: { host: "127.0.0.1", port: 4101, path: "/health", expect: [200, 204] },
    "a-rather-long-service-name": { port: 3000, path: "/a/long/path/that/does/not/fit/anywhere" },
  },
});
const plain = detectTerminal({ isTTY: false }, {});

describe("reports", () => {
  it("never cut a line when the width is unknown", () => {
    expect(formatCheckResults(results, plain)).toBe(
      [
        "✓ api                         http://127.0.0.1:4101/health  200  47ms",
        "✗ a-rather-long-service-name  http://localhost:3000/        connection refused, nothing listens on this port",
      ].join("\n"),
    );
    expect(formatServices(config, plain)).toBe(
      [
        "api                         http://127.0.0.1:4101/health  expect 200,204",
        "a-rather-long-service-name  http://localhost:3000/a/long/path/that/does/not/fit/anywhere",
      ].join("\n"),
    );
  });

  it.each([
    ["NO_COLOR", { NO_COLOR: "1" }],
    ["TERM=dumb", { TERM: "dumb" }],
  ])("write no escape sequence on a terminal with %s", (_label, env) => {
    const terminal = detectTerminal(tty, env);
    expect(formatCheckResults(results, terminal)).not.toContain(ESC);
    expect(formatServices(config, terminal)).not.toContain(ESC);
  });

  it("keep the full layout on a terminal wide enough", () => {
    const wide = detectTerminal({ isTTY: true, columns: 200 }, { NO_COLOR: "1" });
    expect(formatCheckResults(results, wide)).toBe(formatCheckResults(results, plain));
    expect(formatServices(config, wide)).toBe(formatServices(config, plain));
  });

  it.each([100, 59, 40, 20, 9, 6, 1])("fit in %i columns without cutting a sequence", (columns) => {
    const terminal = detectTerminal({ isTTY: true, columns }, {});
    for (const text of [formatCheckResults(results, terminal), formatServices(config, terminal)]) {
      for (const line of text.split("\n")) {
        const visible = stripStyles(line);
        expect(visible).not.toContain(ESC);
        if (columns >= 6) expect(visible.length).toBeLessThanOrEqual(columns);
        // every sequence that opens is closed on the same line
        expect(line.split(`${ESC}[`).length % 2).toBe(1);
      }
    }
  });

  it("print the hint of a failure under its line, never cut when the width is unknown", () => {
    const hint = "nothing listens on :3000: is the service started?";
    const down = [{ ...results[0], ok: false, error: "connection refused", hint }] as CheckResult[];

    expect(formatCheckResults(down, plain)).toBe(
      ["✗ api  http://127.0.0.1:4101/health  connection refused", `  ${hint}`].join("\n"),
    );
  });

  it.each([100, 30, 6])("cut a hint to %i columns", (columns) => {
    const hint = "nothing listens on :3000: is the service started?";
    const down = [{ ...results[0], ok: false, error: "refused", hint }] as CheckResult[];

    for (const env of [{}, { NO_COLOR: "1" }]) {
      const text = formatCheckResults(down, detectTerminal({ isTTY: true, columns }, env));
      const lines = text.split("\n").map(stripStyles);
      expect(lines).toHaveLength(2);
      expect(lines[1]?.length).toBeLessThanOrEqual(columns);
      expect(lines[1]?.startsWith("  noth".slice(0, columns - 1))).toBe(true);
    }
  });

  it("render nothing for an empty list", () => {
    const narrow = detectTerminal({ isTTY: true, columns: 20 }, {});
    expect(formatCheckResults([], narrow)).toBe("");
    expect(formatServices(configSchemaV1.parse({ schemaVersion: 1, services: {} }), narrow)).toBe(
      "",
    );
  });

  it("drop the target and cut the reason on a narrow terminal", () => {
    const narrow = detectTerminal({ isTTY: true, columns: 40 }, { NO_COLOR: "1" });
    expect(formatCheckResults(results, narrow)).toBe(
      ["✓ api                 200  47ms", "✗ a-rather-long-ser…  connection refuse…"].join("\n"),
    );
    expect(formatServices(config, narrow)).toBe(
      ["api                  http://127.0.0.1:4…", "a-rather-long-serv…  http://localhost:3…"].join(
        "\n",
      ),
    );
  });
});
