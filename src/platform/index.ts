import { posixPlatform } from "./posix";
import type { Platform } from "./types";
import { windowsPlatform } from "./windows";

export type { ClipboardTool, Platform } from "./types";

/** The only place that decides by the OS: everything else asks the platform it is given. */
export function platformFor(name: NodeJS.Platform): Platform {
  return name === "win32" ? windowsPlatform() : posixPlatform(name);
}

export const currentPlatform: Platform = platformFor(process.platform);
