import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { NOTIFY_SEND, utf8Locale } from "./shared";
import type { ClipboardTool, Platform } from "./types";

type Spawn = typeof nodeSpawn;

// The terminals known to draw Unicode announce themselves; Windows sets no UTF-8 locale.
const UNICODE_TERMS = new Set([
  "xterm-256color",
  "alacritty",
  "rxvt-unicode",
  "rxvt-unicode-256color",
]);
const UNICODE_PROGRAMS = new Set(["vscode", "Terminus-Sublime"]);

function knownUnicodeTerminal(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(env.CI || env.WT_SESSION || env.TERMINUS_SUBLIME) ||
    env.ConEmuTask === "{cmd::Cmder}" ||
    UNICODE_PROGRAMS.has(env.TERM_PROGRAM ?? "") ||
    UNICODE_TERMS.has(env.TERM ?? "") ||
    env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
  );
}

// Set-Clipboard reads the text as UTF-8; `clip` alone would mangle what is not in the OEM code page.
const POWERSHELL: ClipboardTool = [
  "powershell",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
];
const CLIP: ClipboardTool = ["clip"];

/** `spawn` is a parameter so that tests can see the `taskkill` call without running it. */
export function windowsPlatform(spawn: Spawn = nodeSpawn): Platform {
  return {
    name: "win32",
    drawsUnicode: (env) => knownUnicodeTerminal(env) || utf8Locale(env),
    cacheDir: (env) =>
      join(env.XDG_CACHE_HOME || env.LOCALAPPDATA || join(homedir(), ".cache"), "probe"),
    killTree(child) {
      const { pid } = child;
      if (pid === undefined) return;
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => child.kill());
    },
    ownProcessGroup: false,
    hasCmdShims: true,
    // rundll32 takes the URL as an argument no shell reads: `cmd /c start` would run an `&` of a URL.
    openUrlCommand: (url) => ({ command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }),
    clipboardTools: () => [POWERSHELL, CLIP],
    // No tool is known to show one: the action says it could not, as it does on a Linux without libnotify.
    notifier: { name: "notify-send", command: NOTIFY_SEND },
    // `file://host/C:/x` is read as a share, `file:///C:/x` as the local drive.
    localFileHost: () => undefined,
    hasSs: false,
    hasNetstat: true,
    executableName: async () => undefined,
  };
}
