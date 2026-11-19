import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { configSchemaV1 } from "../src/config/schema";
import { fileUrl, link, linkFile, linkFileIn } from "../src/ui/links";
import { formatCheckResults, formatServices } from "../src/ui/report";
import { detectTerminal } from "../src/ui/terminal";

const ESC = String.fromCharCode(27);
const OSC8 = `${ESC}]8;;`;
const ST = `${ESC}\\`;
const wrapped = (text: string, url: string) => `${OSC8}${url}${ST}${text}${OSC8}${ST}`;
const withoutLinks = (text: string) =>
  text.replaceAll(new RegExp(`${ESC}\\]8;;[^${ESC}]*${ESC}\\\\`, "g"), "");

const linking = detectTerminal(
  { isTTY: true, columns: 120 },
  { TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0", NO_COLOR: "1" },
);
const plain = { ...linking, hyperlinks: false };

const results: CheckResult[] = [
  {
    name: "api",
    type: "http",
    target: "http://localhost:3000/health",
    ok: true,
    status: 200,
    latencyMs: 4,
  },
  { name: "db", type: "mysql", target: "localhost:3306", ok: false, latencyMs: 1, error: "down" },
];
const config = configSchemaV1.parse({
  schemaVersion: 1,
  services: { api: { port: 3000, path: "/health" }, front: { url: "https://example.com" } },
});

describe("link", () => {
  it("wraps the text in an OSC 8 sequence", () => {
    expect(link("here", "https://example.com/a", true)).toBe(
      wrapped("here", "https://example.com/a"),
    );
  });

  it.each([
    ["off", "https://example.com", false],
    ["not a URL", "nothing", true],
    ["a host and a port", "localhost:3306", true],
    ["another scheme", "javascript:alert(1)", true],
  ])("leaves the text alone: %s", (_, url, enabled) => {
    expect(link("here", url, enabled)).toBe("here");
  });

  it("lets no control character of the address end the sequence", () => {
    const linked = link("here", `https://example.com/${ESC}\\${String.fromCharCode(7)}x`, true);

    expect(linked.split(ESC)).toHaveLength(5);
    expect(linked).not.toContain(String.fromCharCode(7));
  });

  it("points a file at this machine", () => {
    const expected =
      process.platform === "win32"
        ? pathToFileURL("/tmp/a b/config.yml").href
        : `file://${hostname().toLowerCase()}/tmp/a%20b/config.yml`;

    expect(fileUrl("/tmp/a b/config.yml")).toBe(expected);
    expect(linkFile(".probe/config.yml", "/p/.probe/config.yml", false)).toBe(".probe/config.yml");
  });
});

describe("linkFileIn", () => {
  const path = "/tmp/pro$&ject/$'/.probe/config.yml";
  const message = `${path} is invalid:\n  services: expected a mapping (${path})`;

  it("links each mention of the file and keeps the rest", () => {
    const linked = linkFileIn(message, path, true);

    expect(linked.split(OSC8)).toHaveLength(5);
    expect(withoutLinks(linked)).toBe(message);
  });

  it("changes nothing when links are off", () => {
    expect(linkFileIn(message, path, false)).toBe(message);
  });
});

describe("the reports", () => {
  it("link the address of a web service, and nothing else", () => {
    const text = formatCheckResults(results, linking);

    expect(text).toContain(wrapped("http://localhost:3000/health", "http://localhost:3000/health"));
    expect(text.split(OSC8)).toHaveLength(3);
  });

  it("link every service of the list to its full address", () => {
    const text = formatServices(config, linking);

    expect(text).toContain(wrapped("http://localhost:3000/health", "http://localhost:3000/health"));
    expect(text).toContain(wrapped("https://example.com", "https://example.com/"));
  });

  it("link the full address when the width cuts the text", () => {
    const narrow = { ...linking, columns: 24 };

    const text = formatServices(config, narrow);

    expect(text).toContain(`${OSC8}http://localhost:3000/health${ST}`);
    expect(withoutLinks(text)).toBe(formatServices(config, { ...narrow, hyperlinks: false }));
  });

  it("are the same text once the links are taken out", () => {
    expect(withoutLinks(formatCheckResults(results, linking))).toBe(
      formatCheckResults(results, plain),
    );
    expect(withoutLinks(formatServices(config, linking))).toBe(formatServices(config, plain));
  });

  it("write no sequence when the terminal has no links", () => {
    expect(formatCheckResults(results, plain)).not.toContain(ESC);
    expect(formatServices(config, plain)).not.toContain(ESC);
  });
});
