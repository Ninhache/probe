import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFY_WAIT_MS } from "../src/constants";
import { type NotifySpawn, notifierCommand, notifierName, sendNotification } from "../src/notify";

type Outcome = "shown" | "missing" | "failed" | "silent";

function fakeSpawn(outcome: Outcome) {
  const calls: { command: string; args: string[]; stdio: string; killed: boolean }[] = [];
  const spawn: NotifySpawn = (command, args, options) => {
    const call = { command, args, stdio: options.stdio, killed: false };
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
  return { spawn, calls };
}

afterEach(() => vi.useRealTimers());

describe("notifierCommand", () => {
  it("should name notify-send on Linux and osascript on macOS", () => {
    expect(notifierName("linux")).toBe("notify-send");
    expect(notifierName("darwin")).toBe("osascript");
  });

  it("should end the options of notify-send before the texts", () => {
    expect(notifierCommand("linux", "probe", "--urgency is down")).toEqual([
      "notify-send",
      "--app-name=probe",
      "--",
      "probe",
      "--urgency is down",
    ]);
  });

  it("should give osascript the texts as arguments, outside the script", () => {
    const text = 'api" & (do shell script "id") & " is down';

    const command = notifierCommand("darwin", "probe", text);

    expect(command.slice(-2)).toEqual(["probe", text]);
    expect(command.slice(0, -2).join(" ")).not.toContain("api");
  });
});

describe("sendNotification", () => {
  it("should run the tool without a terminal to write on when it shows the notification", async () => {
    const { spawn, calls } = fakeSpawn("shown");

    expect(await sendNotification("probe", "api is down", "linux", spawn)).toBe(true);
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

    expect(await sendNotification("probe", "api is down", "linux", spawn)).toBe(false);
  });

  it("should stop a tool that does not answer and say no", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = fakeSpawn("silent");

    const shown = sendNotification("probe", "api is down", "linux", spawn);
    await vi.advanceTimersByTimeAsync(NOTIFY_WAIT_MS);

    expect(await shown).toBe(false);
    expect(calls[0]?.killed).toBe(true);
  });
});
