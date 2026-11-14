import { spawn as nodeSpawn } from "node:child_process";

/** The part of `child_process.spawn` used here, so tests can replace it. */
export type Spawn = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: "ignore" },
) => {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

/** The command that opens a URL in the default browser: `open` on macOS, `xdg-open` elsewhere. */
export function openerCommand(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "open" : "xdg-open";
}

/**
 * Starts the opener of the platform on a URL, without waiting for it: some openers stay in the
 * foreground for as long as the browser runs.
 * Resolves to `false` when the opener cannot be started (not installed), never rejects.
 */
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
