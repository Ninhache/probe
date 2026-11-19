import type { ChildProcess } from "node:child_process";
import { readlink } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";
import { NOTIFY_SEND, utf8Locale } from "./shared";
import type { ClipboardTool, Platform } from "./types";

const WL_COPY: ClipboardTool = ["wl-copy"];
const XCLIP: ClipboardTool = ["xclip", "-selection", "clipboard"];

function killGroup(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is gone already, or never was one: the child itself is all that is left.
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

// On Linux lsof and ss name a process after its main thread: every Node server is "MainThread" there.
async function procExecutableName(pid: number): Promise<string | undefined> {
  try {
    return basename(await readlink(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, "");
  } catch {
    return undefined;
  }
}

const OSASCRIPT = [
  "osascript",
  "-e",
  "on run argv",
  "-e",
  "display notification (item 2 of argv) with title (item 1 of argv)",
  "-e",
  "end run",
];

/** Linux, and any POSIX system without a variant of its own. */
function linuxLike(name: NodeJS.Platform): Platform {
  return {
    name,
    drawsUnicode: utf8Locale,
    cacheDir: (env) => join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "probe"),
    killTree: killGroup,
    ownProcessGroup: true,
    hasCmdShims: false,
    openUrlCommand: (url) => ({ command: "xdg-open", args: [url] }),
    clipboardTools: (env) => (env.WAYLAND_DISPLAY ? [WL_COPY, XCLIP] : [XCLIP, WL_COPY]),
    notifier: { name: "notify-send", command: NOTIFY_SEND },
    localFileHost: () => hostname(),
    pathEntries: (env) => (env.PATH ?? "").split(":").filter(Boolean),
    programNames: (program) => [program],
    hasSs: name === "linux",
    hasNetstat: false,
    executableName: async (pid) => (name === "linux" ? procExecutableName(pid) : undefined),
  };
}

/** Linux and macOS: macOS differs where it has its own tools. */
export function posixPlatform(name: NodeJS.Platform): Platform {
  const base = linuxLike(name);
  if (name !== "darwin") return base;
  return {
    ...base,
    openUrlCommand: (url) => ({ command: "open", args: [url] }),
    clipboardTools: () => [["pbcopy"]],
    notifier: {
      name: "osascript",
      command: (title, text) => [...OSASCRIPT, title, text],
    },
  };
}
