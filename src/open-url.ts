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
  if (platform === "win32") return "rundll32";
  return platform === "darwin" ? "open" : "xdg-open";
}

// rundll32 takes the URL as an argument no shell reads: `cmd /c start` would run an `&` of a URL.
function openerArgs(platform: NodeJS.Platform, url: string): string[] {
  return platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
}

// Not waited for: some openers stay in the foreground for as long as the browser runs.
export function openUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawn: Spawn = nodeSpawn,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(openerCommand(platform), openerArgs(platform, url), {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
