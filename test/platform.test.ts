import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformFor } from "../src/platform";
import { windowsPlatform } from "../src/platform/windows";

const windows = platformFor("win32");
const linux = platformFor("linux");
const mac = platformFor("darwin");

describe("platformFor", () => {
  it("should pick the Windows implementation for win32, the POSIX ones elsewhere", () => {
    expect(windows.name).toBe("win32");
    expect(linux.name).toBe("linux");
    expect(mac.name).toBe("darwin");
    expect(platformFor("freebsd").openUrlCommand("u").command).toBe("xdg-open");
  });
});

describe("windows platform", () => {
  it.each([
    [{ WT_SESSION: "1" }, true],
    [{ CI: "true" }, true],
    [{ TERM_PROGRAM: "vscode" }, true],
    [{ TERM_PROGRAM: "Apple_Terminal" }, false],
    [{ TERM: "xterm-256color" }, true],
    [{ TERM: "xterm" }, false],
    [{ ConEmuTask: "{cmd::Cmder}" }, true],
    [{ TERMINAL_EMULATOR: "JetBrains-JediTerm" }, true],
    [{ LANG: "en_US.UTF-8" }, true],
    [{}, false],
  ])("should read the terminal %j as unicode: %s", (env, unicode) => {
    expect(windows.drawsUnicode(env)).toBe(unicode);
  });

  it("should keep its cache in LOCALAPPDATA unless XDG_CACHE_HOME says otherwise", () => {
    const local = join("C:", "Users", "me", "AppData", "Local");

    expect(windows.cacheDir({ LOCALAPPDATA: local })).toBe(join(local, "probe"));
    expect(windows.cacheDir({ LOCALAPPDATA: local, XDG_CACHE_HOME: "/xdg" })).toBe(
      join("/xdg", "probe"),
    );
    expect(windows.cacheDir({})).toBe(join(homedir(), ".cache", "probe"));
  });

  it("should kill the tree with taskkill, and the child alone when taskkill is missing", () => {
    const calls: { command: string; args: string[] }[] = [];
    let onError: () => void = () => {};
    let killed = 0;
    const platform = windowsPlatform(((command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        on: (_event: string, listener: () => void) => {
          onError = listener;
        },
      };
    }) as never);
    const child = { pid: 42, kill: () => void killed++ } as unknown as ChildProcess;

    platform.killTree(child);
    onError();

    expect(calls).toEqual([{ command: "taskkill", args: ["/pid", "42", "/T", "/F"] }]);
    expect(killed).toBe(1);
  });

  it("should open a URL with rundll32, the URL being one argument", () => {
    expect(windows.openUrlCommand("http://a/?x=1&y=2")).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", "http://a/?x=1&y=2"],
    });
  });

  it("should not give its children a process group, and know the .cmd shims", () => {
    expect(windows.ownProcessGroup).toBe(false);
    expect(windows.hasCmdShims).toBe(true);
  });

  it("should leave the host out of file URLs, and copy with PowerShell then clip", () => {
    expect(windows.localFileHost()).toBeUndefined();
    expect(windows.clipboardTools({}).map(([tool]) => tool)).toEqual(["powershell", "clip"]);
  });
});

describe("posix platforms", () => {
  it("should read unicode from the locale", () => {
    expect(linux.drawsUnicode({ LANG: "fr_FR.UTF-8" })).toBe(true);
    expect(linux.drawsUnicode({ WT_SESSION: "1" })).toBe(false);
  });

  it("should keep the cache under XDG_CACHE_HOME, else ~/.cache", () => {
    expect(linux.cacheDir({ XDG_CACHE_HOME: "/xdg" })).toBe(join("/xdg", "probe"));
    expect(linux.cacheDir({ LOCALAPPDATA: "/ignored" })).toBe(join(homedir(), ".cache", "probe"));
  });

  it("should differ on macOS only where it has its own tools", () => {
    expect(mac.openUrlCommand("u")).toEqual({ command: "open", args: ["u"] });
    expect(linux.openUrlCommand("u")).toEqual({ command: "xdg-open", args: ["u"] });
    expect(mac.clipboardTools({}).map(([tool]) => tool)).toEqual(["pbcopy"]);
    expect(linux.clipboardTools({ WAYLAND_DISPLAY: "w" }).map(([tool]) => tool)).toEqual([
      "wl-copy",
      "xclip",
    ]);
    expect(linux.clipboardTools({}).map(([tool]) => tool)).toEqual(["xclip", "wl-copy"]);
    expect(mac.ownProcessGroup && linux.ownProcessGroup).toBe(true);
  });

  it("should allow ss on Linux only", () => {
    expect(linux.hasSs).toBe(true);
    expect(mac.hasSs).toBe(false);
  });
});

describe("program lookup", () => {
  const winEnv = { Path: 'C:\\bin;"C:\\Program Files\\Git\\usr\\bin";', PATHEXT: ".EXE;.CMD" };

  it("should list the PATH directories of each OS, whatever the spelling of the variable", () => {
    expect(windows.pathEntries(winEnv)).toEqual(["C:\\bin", "C:\\Program Files\\Git\\usr\\bin"]);
    expect(linux.pathEntries({ PATH: "/usr/bin::/bin" })).toEqual(["/usr/bin", "/bin"]);
    expect(linux.pathEntries({})).toEqual([]);
  });

  it("should name a Windows program by the extensions of PATHEXT, never bare", () => {
    expect(windows.programNames("make", winEnv)).toEqual(["make.EXE", "make.CMD"]);
    expect(windows.programNames("make", {})).toEqual([
      "make.COM",
      "make.EXE",
      "make.BAT",
      "make.CMD",
    ]);
    expect(linux.programNames("make", {})).toEqual(["make"]);
    expect(mac.programNames("make", {})).toEqual(["make"]);
  });
});
