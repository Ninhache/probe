import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFY_WAIT_MS } from "../src/constants";
import { type NotifySpawn, sendNotification } from "../src/notify";
import { platformFor } from "../src/platform";
import { TOAST_SCRIPT } from "../src/platform/windows";

type Outcome = "shown" | "missing" | "failed" | "silent";

function fakeSpawn(outcome: Outcome) {
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const calls: { command: string; args: string[]; stdio: string; killed: boolean }[] = [];
  const spawn: NotifySpawn = (command, args, options) => {
    const call = { command, args, stdio: options.stdio, killed: false };
    envs.push(options.env);
    calls.push(call);
    const child = new EventEmitter();
    queueMicrotask(() => {
      if (outcome === "missing") child.emit("error", new Error("spawn ENOENT"));
      else if (outcome !== "silent") child.emit("exit", outcome === "shown" ? 0 : 1);
    });
    return Object.assign(child, {
      kill: () => {
        call.killed = true;
      },
    });
  };
  return { spawn, calls, envs };
}

afterEach(() => vi.useRealTimers());

describe("notifierCommand", () => {
  it("should name notify-send on Linux and osascript on macOS", () => {
    expect(platformFor("linux").notifier.name).toBe("notify-send");
    expect(platformFor("darwin").notifier.name).toBe("osascript");
  });

  it("should end the options of notify-send before the texts", () => {
    expect(platformFor("linux").notifier.command("probe", "--urgency is down")).toEqual([
      "notify-send",
      "--app-name=probe",
      "--",
      "probe",
      "--urgency is down",
    ]);
  });

  it("should give osascript the texts as arguments, outside the script", () => {
    const text = 'api" & (do shell script "id") & " is down';

    const command = platformFor("darwin").notifier.command("probe", text);

    expect(command.slice(-2)).toEqual(["probe", text]);
    expect(command.slice(0, -2).join(" ")).not.toContain("api");
  });
});

const HOSTILE = [
  `it's "quoted"`,
  "$(calc.exe) ; `whoami` & <b>x</b> > out",
  "'; Remove-Item -Recurse C:\\ ; '",
  "caf\u00e9 \u2014 \u65e5\u672c\u8a9e \u{1f680}",
];

describe("windows notifier", () => {
  const { notifier } = platformFor("win32");

  it("should run Windows PowerShell hidden, with a script that is the same for every text", () => {
    const [command, ...args] = notifier.command("probe", "api is down");

    expect(command).toBe("powershell.exe");
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      TOAST_SCRIPT,
    ]);
    expect(notifier.command("other", "x")).toEqual(notifier.command("probe", "api is down"));
  });

  it.each(HOSTILE)("should keep %j out of the command and give it as data", (hostile) => {
    expect(notifier.command(hostile, hostile).join("\n")).not.toContain(hostile);
    expect(notifier.env?.(hostile, hostile)).toEqual({
      PROBE_TOAST_TITLE: hostile,
      PROBE_TOAST_TEXT: hostile,
    });
  });

  it("should not put a double quote in the script, so that no escaping of the command line is needed", () => {
    expect(TOAST_SCRIPT).not.toContain('"');
  });

  it.skipIf(process.platform !== "win32")(
    "should give a script that PowerShell parses (Windows only: powershell.exe)",
    () => {
      const run = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[void][scriptblock]::Create($env:PROBE_SCRIPT)",
        ],
        {
          env: { ...process.env, PROBE_SCRIPT: TOAST_SCRIPT },
          encoding: "utf8",
          windowsHide: true,
        },
      );

      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
    },
  );
});

describe("sendNotification", () => {
  it("should hand the texts to a notifier that wants them in the environment of the child", async () => {
    const { spawn, envs } = fakeSpawn("shown");

    await sendNotification("probe", "api is down", platformFor("win32"), spawn);

    expect(envs[0]).toMatchObject({ PROBE_TOAST_TITLE: "probe", PROBE_TOAST_TEXT: "api is down" });
  });

  it("should leave the environment alone for a notifier that takes arguments", async () => {
    const { spawn, envs } = fakeSpawn("shown");

    await sendNotification("probe", "api is down", platformFor("linux"), spawn);

    expect(envs[0]).toBeUndefined();
  });

  it("should run the tool without a terminal to write on when it shows the notification", async () => {
    const { spawn, calls } = fakeSpawn("shown");

    expect(await sendNotification("probe", "api is down", platformFor("linux"), spawn)).toBe(true);
    expect(calls).toEqual([
      {
        command: "notify-send",
        args: ["--app-name=probe", "--", "probe", "api is down"],
        stdio: "ignore",
        killed: false,
      },
    ]);
  });

  it.each(["missing", "failed"] as const)("should say no when the tool is %s", async (outcome) => {
    const { spawn } = fakeSpawn(outcome);

    expect(await sendNotification("probe", "api is down", platformFor("linux"), spawn)).toBe(false);
  });

  it("should stop a tool that does not answer and say no", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = fakeSpawn("silent");

    const shown = sendNotification("probe", "api is down", platformFor("linux"), spawn);
    await vi.advanceTimersByTimeAsync(NOTIFY_WAIT_MS);

    expect(await shown).toBe(false);
    expect(calls[0]?.killed).toBe(true);
  });
});
