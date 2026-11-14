import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { curlCommand } from "../src/checkers/http";
import { serviceSchemaV1 } from "../src/config/schema";
import { openerCommand, openUrl, type Spawn } from "../src/open-url";

const URL = "http://localhost:3000/health";

/** A spawn that records its calls and lets the test decide how the child starts. */
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

      expect(await openUrl(URL, platform, spawn)).toBe(true);
      expect(calls).toEqual([{ command, args: [URL], unrefs: 1 }]);
      expect(openerCommand(platform)).toBe(command);
    },
  );

  it("resolves to false when the command cannot be started", async () => {
    const { spawn } = fakeSpawn("error");

    expect(await openUrl(URL, "linux", spawn)).toBe(false);
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
