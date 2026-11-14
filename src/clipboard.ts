import { spawn as nodeSpawn } from "node:child_process";

/** The part of `child_process.spawn` used here, so tests can replace it. */
export type ClipboardSpawn = (
  command: string,
  args: string[],
  options: { stdio: ["pipe", "ignore", "ignore"] },
) => {
  stdin: {
    on(event: "error", listener: (error: Error) => void): unknown;
    end(text: string): unknown;
  } | null;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

type Tool = readonly [command: string, ...args: string[]];

const WL_COPY: Tool = ["wl-copy"];
const XCLIP: Tool = ["xclip", "-selection", "clipboard"];

/**
 * The tools that write to the clipboard, the most likely to work first: `pbcopy` on macOS;
 * elsewhere `wl-copy` and `xclip`, `wl-copy` first under Wayland.
 */
export function clipboardTools(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Tool[] {
  if (platform === "darwin") return [["pbcopy"]];
  return env.WAYLAND_DISPLAY ? [WL_COPY, XCLIP] : [XCLIP, WL_COPY];
}

function copiedWith([command, ...args]: Tool, text: string, spawn: ClipboardSpawn) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", () => resolve(false));
    // `exit`, not `close`: wl-copy and xclip leave a process behind that keeps the selection.
    child.once("exit", (code) => resolve(code === 0));
    // A tool that stops before reading (no display) must not take the caller down with EPIPE.
    child.stdin?.on("error", () => {});
    child.stdin?.end(text);
  });
}

/**
 * Copies a text to the clipboard with the first tool that works.
 * Resolves to `false` when none does (not installed, no display), never rejects.
 */
export async function copyText(
  text: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  spawn: ClipboardSpawn = nodeSpawn,
): Promise<boolean> {
  for (const tool of clipboardTools(platform, env)) {
    if (await copiedWith(tool, text, spawn)) return true;
  }
  return false;
}
