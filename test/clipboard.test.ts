import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { type ClipboardSpawn, clipboardTools, copyText } from "../src/clipboard";

const TEXT = "curl -i -L --max-time 3 'http://localhost:3000/health'";

type Outcome = "copied" | "missing" | "failed";

/** A spawn that records its calls; each tool ends the way the test decides. */
function fakeSpawn(outcomes: Record<string, Outcome>) {
  const calls: { command: string; args: string[]; written: string }[] = [];
  const spawn: ClipboardSpawn = (command, args) => {
    const call = { command, args, written: "" };
    calls.push(call);
    const child = new EventEmitter();
    const outcome = outcomes[command] ?? "missing";
    queueMicrotask(() => {
      if (outcome === "missing") child.emit("error", new Error("spawn ENOENT"));
      else child.emit("exit", outcome === "copied" ? 0 : 1);
    });
    const stdin = {
      on: () => stdin,
      end: (text: string) => {
        call.written = text;
      },
    };
    return Object.assign(child, { stdin });
  };
  return { spawn, calls };
}

describe("clipboardTools", () => {
  it.each([
    ["darwin", {}, ["pbcopy"]],
    ["linux", { WAYLAND_DISPLAY: "wayland-1" }, ["wl-copy", "xclip"]],
    ["linux", {}, ["xclip", "wl-copy"]],
  ] as const)("should list on %s with %o the tools %o", (platform, env, tools) => {
    expect(clipboardTools(platform, env).map(([tool]) => tool)).toEqual(tools);
  });
});

describe("copyText", () => {
  it("should write the text as it is to pbcopy when on macOS", async () => {
    const { spawn, calls } = fakeSpawn({ pbcopy: "copied" });

    expect(await copyText(TEXT, "darwin", {}, spawn)).toBe(true);
    expect(calls).toEqual([{ command: "pbcopy", args: [], written: TEXT }]);
  });

  it("should use the clipboard selection of xclip when wl-copy is missing", async () => {
    const { spawn, calls } = fakeSpawn({ xclip: "copied" });

    expect(await copyText(TEXT, "linux", { WAYLAND_DISPLAY: "wayland-1" }, spawn)).toBe(true);
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["wl-copy"],
      ["xclip", "-selection", "clipboard"],
    ]);
  });

  it("should try the next tool when one exits with an error", async () => {
    const { spawn, calls } = fakeSpawn({ xclip: "failed", "wl-copy": "copied" });

    expect(await copyText(TEXT, "linux", {}, spawn)).toBe(true);
    expect(calls.map(({ command }) => command)).toEqual(["xclip", "wl-copy"]);
  });

  it("should resolve to false when no tool works", async () => {
    const { spawn } = fakeSpawn({ xclip: "failed" });

    expect(await copyText(TEXT, "linux", {}, spawn)).toBe(false);
  });
});
