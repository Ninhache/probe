import { closeSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { markerVersion } from "../completion/marker";
import type { Shell } from "../completion/spec";
import { isNewer } from "./notifier";

/** Enough for the first lines of a script: the rest is never read. */
const HEAD_BYTES = 512;

export interface CompletionPlace {
  shell: Shell;
  path: string;
}

export interface CompletionEnv {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Where `probe completion <shell>` is saved, as the docs say: the only places looked at. */
export function completionPlaces({
  env = process.env,
  home = homedir(),
}: CompletionEnv = {}): CompletionPlace[] {
  return [
    { shell: "zsh", path: join(home, ".zfunc", "_probe") },
    {
      shell: "fish",
      path: join(env.XDG_CONFIG_HOME || join(home, ".config"), "fish", "completions", "probe.fish"),
    },
    {
      shell: "bash",
      path: join(
        env.XDG_DATA_HOME || join(home, ".local", "share"),
        "bash-completion",
        "completions",
        "probe",
      ),
    },
  ];
}

/** The head of a file, or undefined when there is no such file. */
function head(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const shown = (path: string, home: string) =>
  path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;

/**
 * One warning per saved script written by an older probe, or by one that did not mark its scripts.
 * `eval` and `source` usages are never saved, so they are always fresh and never named.
 */
export function staleCompletions(current: string, where: CompletionEnv = {}): string[] {
  const home = where.home ?? homedir();
  return completionPlaces(where).flatMap(({ shell, path }) => {
    const text = head(path);
    if (text === undefined) return [];
    const written = markerVersion(text);
    if (written !== undefined && !isNewer(current, written)) return [];
    const from = written ?? "an older probe";
    const target = shown(path, home);
    return [
      `Saved ${shell} completion is from ${from}: run \`probe completion ${shell} > ${target}\``,
    ];
  });
}
