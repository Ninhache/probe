import type { ChildProcess } from "node:child_process";

/** A program and its arguments, as the clipboard tools are listed: the first one that exists wins. */
export type ClipboardTool = readonly [command: string, ...args: string[]];

/**
 * What differs between operating systems, chosen once by `platformFor`. Code that needs one of
 * these asks the platform it is given instead of reading `process.platform`.
 */
export interface Platform {
  readonly name: NodeJS.Platform;
  /** Whether a terminal of this OS draws more than ASCII, as far as its environment says. */
  drawsUnicode(env: NodeJS.ProcessEnv): boolean;
  /** Where probe keeps what it learns between runs (the update check, what was seen). */
  cacheDir(env: NodeJS.ProcessEnv): string;
  /** Kills the child and everything it started. */
  killTree(child: ChildProcess): void;
  /** Whether a child gets its own process group, which `killTree` then signals at once. */
  readonly ownProcessGroup: boolean;
  /** Whether a program of the PATH can be a `.cmd` shim, which Node does not run without a shell. */
  readonly hasCmdShims: boolean;
  /** The program that opens a URL in the default browser. */
  openUrlCommand(url: string): { command: string; args: string[] };
  clipboardTools(env: NodeJS.ProcessEnv): ClipboardTool[];
  readonly notifier: {
    name: string;
    /** Title and text are arguments, never part of a script. */
    command(title: string, text: string): string[];
  };
  /** The host name `file:` URLs carry so that a terminal over ssh opens no file of the wrong machine. */
  localFileHost(): string | undefined;
  /** Whether `ss` can stand in for a missing `lsof`. */
  readonly hasSs: boolean;
  /** The real name of the executable of a process, where lsof and ss only give a thread name. */
  executableName(pid: number): Promise<string | undefined>;
}
