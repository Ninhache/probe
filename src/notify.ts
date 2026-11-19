import { spawn as nodeSpawn } from "node:child_process";
import { NOTIFY_WAIT_MS } from "./constants";
import { currentPlatform, type Platform } from "./platform";

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

export function sendNotification(
  title: string,
  text: string,
  platform: Platform = currentPlatform,
  spawn: NotifySpawn = nodeSpawn,
): Promise<boolean> {
  const [command = "", ...args] = platform.notifier.command(title, text);
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
