import { pathToFileURL } from "node:url";
import { currentPlatform, type Platform } from "../platform";

const ESC = "\u001b";
const OPEN = `${ESC}]8;;`;
const END = `${ESC}\\`;
const SCHEMES = ["http:", "https:", "file:"];

/** `text` as an OSC 8 hyperlink to `url`, or `text` alone when `enabled` is off or the URL is not one. */
export function link(text: string, url: string, enabled: boolean): string {
  if (!enabled || text === "" || !URL.canParse(url)) return text;
  const { protocol, href } = new URL(url);
  // `localhost:3306` parses as a URL too: only what a terminal opens gets a link.
  if (!SCHEMES.includes(protocol)) return text;
  // `href` percent-encodes control characters: none can end the sequence early.
  return `${OPEN}${href}${END}${text}${OPEN}${END}`;
}

export function fileUrl(path: string, platform: Platform = currentPlatform): string {
  const url = pathToFileURL(path);
  const host = platform.localFileHost();
  if (host !== undefined) url.hostname = host;
  return url.href;
}

export function linkFile(text: string, path: string, enabled: boolean): string {
  return link(text, fileUrl(path), enabled);
}

export function linkFileIn(message: string, path: string, enabled: boolean): string {
  const linked = linkFile(path, path, enabled);
  // A function: a `$` in the path means nothing to it.
  return message.replaceAll(path, () => linked);
}
