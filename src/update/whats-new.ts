import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAST_SEEN_FILE, RELEASES_URL, UPDATE_CACHE_FILE } from "../constants";
import { createColors } from "../ui/colors";
import { isNewer } from "./notifier";
import { IMPORTANT_KINDS, RELEASE_NOTES, type ReleaseNotes } from "./release-notes";
import { type CompletionEnv, staleCompletions } from "./stale-completion";

/** What shows after an update: the notes of the versions skipped, newest first. */
export interface Upgrade {
  current: string;
  /** The version last seen; null when it is not known (upgrading from before this existed). */
  from: string | null;
  notes: readonly ReleaseNotes[];
}

/** The lines of the notes, ready for the terminal or for the dashboard. */
export interface News {
  version: string;
  title: string;
  lines: { mark: "!" | "+"; text: string }[];
  link: string;
}

/** The most lines under the title: the others are counted, not listed. */
export const MAX_NEWS_LINES = 8;

const isRelease = (version: string) => /^\d+\.\d+\.\d+$/.test(version);

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

const newestFirst = (notes: readonly ReleaseNotes[]) =>
  [...notes].sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1));

/**
 * The notes to show now, once: those of every version after the last one seen, up to `current`.
 * The version is stored as seen. A first install, a same version and a downgrade show nothing,
 * and no file error ever escapes.
 */
export function takeWhatsNew(
  current: string,
  dir: string,
  notes: readonly ReleaseNotes[] = RELEASE_NOTES,
): Upgrade | null {
  if (!isRelease(current)) return null;
  try {
    const seen = readText(join(dir, LAST_SEEN_FILE));
    // Before this file existed, the update check had already written its cache: a user who upgrades.
    const upgrading = seen === null && readText(join(dir, UPDATE_CACHE_FILE)) !== null;
    if (seen !== null && !isNewer(current, seen)) return null;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LAST_SEEN_FILE), current);
    if (seen === null && !upgrading) return null;
    const unseen = notes.filter(
      ({ version }) =>
        !isNewer(version, current) &&
        (seen === null ? version === current : isNewer(version, seen)),
    );
    return unseen.length === 0 ? null : { current, from: seen, notes: newestFirst(unseen) };
  } catch {
    return null;
  }
}

/**
 * Stores a first install as seen without showing anything: a run that cannot show the notes
 * (a script, a pipe) must not leave the next one thinking it is an upgrade.
 */
export function markFirstRun(current: string, dir: string): void {
  if (!isRelease(current)) return;
  try {
    if (readText(join(dir, LAST_SEEN_FILE)) !== null) return;
    if (readText(join(dir, UPDATE_CACHE_FILE)) !== null) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LAST_SEEN_FILE), current);
  } catch {
    // nothing to remember: the next run decides again
  }
}

/** The notes of the running version alone, to read again later. */
export function currentNotes(
  current: string,
  notes: readonly ReleaseNotes[] = RELEASE_NOTES,
): Upgrade | null {
  const [latest] = newestFirst(notes.filter(({ version }) => !isNewer(version, current)));
  return latest ? { current, from: null, notes: [latest] } : null;
}

/** The notes as lines: what asks for an action first (`!`), then the rest, capped. */
export function newsOf({ current, from, notes }: Upgrade, warnings: readonly string[] = []): News {
  const items = notes.flatMap(({ items: each }) => each);
  const important = items.filter(({ kind }) => IMPORTANT_KINDS.includes(kind));
  const rest = items.filter(({ kind }) => !IMPORTANT_KINDS.includes(kind));
  const lines = [
    ...[...warnings, ...important.map(({ text }) => text)].map((text) => ({
      mark: "!" as const,
      text,
    })),
    ...rest.map(({ text }) => ({ mark: "+" as const, text })),
  ];
  const shown =
    lines.length > MAX_NEWS_LINES
      ? [
          ...lines.slice(0, MAX_NEWS_LINES - 1),
          { mark: "+" as const, text: `${lines.length - MAX_NEWS_LINES + 1} more` },
        ]
      : lines;
  return {
    version: current,
    title: from === null ? `probe ${current}` : `probe ${current} (you had ${from})`,
    lines: shown,
    link: `All notes: ${RELEASES_URL}`,
  };
}

/** The notes for a terminal: the title, an indented line for each, the link. */
export function renderNews({ title, lines, link }: News, color: boolean): string {
  const paint = createColors(color);
  return [
    paint.bold(title),
    ...lines.map(
      ({ mark, text }) => `  ${mark === "!" ? paint.yellow("!") : paint.green("+")} ${text}`,
    ),
    `  ${paint.dim(link)}`,
  ].join("\n");
}

/** The notes for a terminal, once, with the warnings about saved completion scripts; null when none. */
export function whatsNewNotice(
  current: string,
  dir: string,
  color: boolean,
  where: CompletionEnv = {},
): string | null {
  const upgrade = takeWhatsNew(current, dir);
  return upgrade && renderNews(newsOf(upgrade, staleCompletions(current, where)), color);
}
