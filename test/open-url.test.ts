import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { curlCommand } from "../src/checkers/http";
import { serviceSchemaV1 } from "../src/config/schema";
import { openUrl, type Spawn } from "../src/open-url";
import { platformFor } from "../src/platform";

const URL = "http://localhost:3000/health";

function fakeSpawn(outcome: "spawn" | "error") {
  const calls: { command: string; args: string[]; unrefs: number }[] = [];
  const spawn: Spawn = (command, args) => {
    const call = { command, args, unrefs: 0 };
    calls.push(call);
    const child = new EventEmitter();
    queueMicrotask(() =>
      outcome === "spawn" ? child.emit("spawn") : child.emit("error", new Error("spawn ENOENT")),
    );
    return Object.assign(child, { unref: () => void call.unrefs++ });
  };
  return { spawn, calls };
}

describe("openUrl", () => {
  it.each([
    ["darwin", "open"],
    ["linux", "xdg-open"],
    ["freebsd", "xdg-open"],
  ] as const)(
    "starts on %s the command %s with the URL, without waiting for it",
    async (platform, command) => {
      const { spawn, calls } = fakeSpawn("spawn");

      expect(await openUrl(URL, platformFor(platform), spawn)).toBe(true);
      expect(calls).toEqual([{ command, args: [URL], unrefs: 1 }]);
    },
  );

  it("starts on win32 rundll32 with the URL as an argument, no shell reads it", async () => {
    const { spawn, calls } = fakeSpawn("spawn");
    const url = "http://localhost:3000/a?b=1&c=2";

    expect(await openUrl(url, platformFor("win32"), spawn)).toBe(true);
    expect(calls).toEqual([
      { command: "rundll32", args: ["url.dll,FileProtocolHandler", url], unrefs: 1 },
    ]);
  });

  it("resolves to false when the command cannot be started", async () => {
    const { spawn } = fakeSpawn("error");

    expect(await openUrl(URL, platformFor("linux"), spawn)).toBe(false);
  });
});

describe("curlCommand", () => {
  const service = (input: object) => serviceSchemaV1.parse({ port: 3000, ...input });

  it("requests the URL the check requests, with its time limit, following redirects", () => {
    expect(curlCommand(service({ path: "/health" }))).toBe(
      "curl -i -L --max-time 3 'http://localhost:3000/health'",
    );
  });

  it("uses the timeout of the service", () => {
    expect(curlCommand(service({ timeout: 10 }))).toContain("--max-time 10 ");
  });

  it("does not follow redirects when a 3xx is expected, as the check does", () => {
    expect(curlCommand(service({ expect: [200, 302] }))).toBe(
      "curl -i --max-time 3 'http://localhost:3000/'",
    );
  });

  it("quotes the URL so the shell reads it as one word", () => {
    expect(curlCommand(service({ path: "/a?b=1&c=it's" }))).toBe(
      "curl -i -L --max-time 3 'http://localhost:3000/a?b=1&c=it'\\''s'",
    );
  });
});
