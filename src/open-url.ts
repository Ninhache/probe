import { spawn as nodeSpawn } from "node:child_process";

export type Spawn = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: "ignore" },
) => {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

export function openerCommand(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "open" : "xdg-open";
}

// Not waited for: some openers stay in the foreground for as long as the browser runs.
export function openUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawn: Spawn = nodeSpawn,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(openerCommand(platform), [url], { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
