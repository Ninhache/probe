import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { utf8Locale } from "./shared";
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

const TOAST_TITLE_VAR = "PROBE_TOAST_TITLE";
const TOAST_TEXT_VAR = "PROBE_TOAST_TEXT";
// The AUMID of PowerShell itself: a toast needs an app id, and this one is registered on every Windows.
const TOAST_APP_ID =
  "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
// Fixed text: title and text come in through the environment, and the DOM escapes them as text nodes.
// No double quote in it, so that the command line of the child needs no escaping.
export const TOAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
  "[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]",
  "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
  "$xml.LoadXml('<toast><visual><binding template=''ToastGeneric''><text/><text/></binding></visual></toast>')",
  "$lines = $xml.GetElementsByTagName('text')",
  `$lines.Item(0).InnerText = $env:${TOAST_TITLE_VAR}`,
  `$lines.Item(1).InnerText = $env:${TOAST_TEXT_VAR}`,
  "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
  `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TOAST_APP_ID}').Show($toast)`,
].join("; ");

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

// Windows names variables without regard to case, but a copy of process.env is a plain object: `Path` is the usual spelling.
function variable(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

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
    // powershell.exe, not pwsh: only Windows PowerShell 5.1 loads the WinRT toast types.
    notifier: {
      name: "powershell",
      command: () => [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        TOAST_SCRIPT,
      ],
      env: (title, text) => ({ [TOAST_TITLE_VAR]: title, [TOAST_TEXT_VAR]: text }),
    },
    // `file://host/C:/x` is read as a share, `file:///C:/x` as the local drive.
    localFileHost: () => undefined,
    pathEntries: (env) =>
      (variable(env, "PATH") ?? "")
        .split(";")
        .map((entry) => entry.replace(/^"(.*)"$/, "$1"))
        .filter(Boolean),
    // A bare `make` file is not a program here: only an extension of PATHEXT makes it one.
    programNames: (program, env) =>
      (variable(env, "PATHEXT") || DEFAULT_PATHEXT)
        .split(";")
        .filter(Boolean)
        .map((extension) => `${program}${extension}`),
    hasSs: false,
    hasNetstat: true,
    executableName: async () => undefined,
  };
}
