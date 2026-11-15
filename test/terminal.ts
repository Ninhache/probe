import { execFile, execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const PTY = resolve(import.meta.dirname, "fixtures", "on-terminal.py");

export const ENTER = "\r";
export const CTRL_C = "\u0003";

export function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export type Step = [marker: string, keys: string];

export function onTerminal(
  cwd: string,
  args: string[],
  steps: Step[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number; screen: string }> {
  const env = {
    ...process.env,
    PROBE_NO_UPDATE_CHECK: "1",
    TERM: "xterm-256color",
    // CI is set on the runners, and it turns every question off.
    CI: "",
    // No port of the machine is tried: a dev server running there would add a question.
    PROBE_DETECT_PORTS: "",
    ...extraEnv,
  };
  return new Promise((done) => {
    execFile(
      "python3",
      [PTY, JSON.stringify(steps), process.execPath, CLI, ...args],
      { cwd, env },
      (error, stdout) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        done({ code: Number(code), screen: stdout });
      },
    );
  });
}
