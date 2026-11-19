import { spawn as nodeSpawn } from "node:child_process";

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
// Set-Clipboard reads the text as UTF-8; `clip` alone would mangle what is not in the OEM code page.
const POWERSHELL: Tool = [
  "powershell",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
];
const CLIP: Tool = ["clip"];

export function clipboardTools(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Tool[] {
  if (platform === "darwin") return [["pbcopy"]];
  if (platform === "win32") return [POWERSHELL, CLIP];
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
