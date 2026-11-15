import { spawn as nodeSpawn } from "node:child_process";
import { NOTIFY_WAIT_MS } from "./constants";

/** The part of `child_process.spawn` used here, so tests can replace it. */
export type NotifySpawn = (
  command: string,
  args: string[],
  // Nothing the tool prints may reach the terminal: the dashboard draws there.
  options: { stdio: "ignore" },
) => {
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  kill(): unknown;
};

/** The tool that shows a desktop notification: `osascript` on macOS, `notify-send` elsewhere. */
export function notifierName(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "osascript" : "notify-send";
}

/** The command that shows a notification. Title and text are arguments, never part of a script. */
export function notifierCommand(platform: NodeJS.Platform, title: string, text: string): string[] {
  if (platform !== "darwin") return ["notify-send", "--app-name=probe", "--", title, text];
  return [
    "osascript",
    "-e",
    "on run argv",
    "-e",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "-e",
    "end run",
    title,
    text,
  ];
}

/**
 * Shows a desktop notification. Resolves to `false` when it could not (tool not installed, no
 * desktop to show it, no answer in time), never rejects.
 */
export function sendNotification(
  title: string,
  text: string,
  platform: NodeJS.Platform = process.platform,
  spawn: NotifySpawn = nodeSpawn,
): Promise<boolean> {
  const [command = "", ...args] = notifierCommand(platform, title, text);
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    // Without a desktop the tool can wait a long time for an answer.
    const late = setTimeout(() => {
      child.kill();
      resolve(false);
    }, NOTIFY_WAIT_MS);
    const settle = (shown: boolean) => {
      clearTimeout(late);
      resolve(shown);
    };
    child.once("error", () => settle(false));
    child.once("exit", (code) => settle(code === 0));
  });
}
