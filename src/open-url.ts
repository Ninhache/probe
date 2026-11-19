import { spawn as nodeSpawn } from "node:child_process";
import { currentPlatform, type Platform } from "./platform";

export type Spawn = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: "ignore" },
) => {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

export function openUrl(
  url: string,
  platform: Platform = currentPlatform,
  spawn: Spawn = nodeSpawn,
): Promise<boolean> {
  return new Promise((resolve) => {
    const { command, args } = platform.openUrlCommand(url);
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
