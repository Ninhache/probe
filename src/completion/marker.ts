const PREFIX = "# probe completion ";
/** A marker is one of the first lines: a saved script is read for its head only. */
export const MARKER_LINES = 6;

/** The line that tells which probe wrote a completion script. */
export const completionMarker = (version: string): string => `${PREFIX}${version}`;

/** The version a completion script was written by, from its first lines; undefined when it has no marker. */
export function markerVersion(head: string): string | undefined {
  for (const line of head.split("\n").slice(0, MARKER_LINES)) {
    if (line.startsWith(PREFIX)) return line.slice(PREFIX.length).trim() || undefined;
  }
  return undefined;
}
