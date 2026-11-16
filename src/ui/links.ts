import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

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

// With the host name: a terminal reached over ssh does not open a file of the wrong machine.
export function fileUrl(path: string): string {
  const url = pathToFileURL(path);
  url.hostname = hostname();
  return url.href;
}

export function linkFile(text: string, path: string, enabled: boolean): string {
  return link(text, fileUrl(path), enabled);
}
