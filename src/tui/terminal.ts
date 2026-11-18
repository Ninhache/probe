import { constants } from "node:os";
import { ansi } from "./ansi";

export type TerminalOptions = {
  mouse?: boolean;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
};

/**
 * Owns the terminal: raw mode, alternate screen, cursor, mouse. Its main job is putting
 * everything back on every exit path (normal exit, signal, crash). Otherwise the user's shell
 * is left with no echo and no cursor.
 */
export class Terminal {
  private readonly out: NodeJS.WriteStream;
  private readonly inp: NodeJS.ReadStream;
  private readonly mouse: boolean;
  private active = false;

  constructor(opts: TerminalOptions = {}) {
    this.out = opts.stdout ?? process.stdout;
    this.inp = opts.stdin ?? process.stdin;
    this.mouse = opts.mouse ?? false;
  }

  get cols(): number {
    return this.out.columns ?? 80;
  }

  get rows(): number {
    return this.out.rows ?? 24;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Raw mode: keys arrive one by one, no echo, Ctrl+C arrives as "\x03" instead of SIGINT.
    if (this.inp.isTTY) this.inp.setRawMode(true);
    this.inp.setEncoding("utf8");
    this.inp.resume();
    this.out.write(
      ansi.altScreenOn +
        ansi.cursorHide +
        ansi.wrapOff +
        ansi.clear +
        (this.mouse ? ansi.mouseOn : ""),
    );
    process.on("exit", this.leave);
    process.on("SIGTERM", this.onSignal);
    process.on("SIGHUP", this.onSignal);
    process.on("uncaughtException", this.onCrash);
    process.on("unhandledRejection", this.onCrash);
  }

  /** Restore the terminal. Safe to call more than once. */
  leave = (): void => {
    if (!this.active) return;
    this.active = false;
    this.out.write(
      (this.mouse ? ansi.mouseOff : "") +
        ansi.reset +
        ansi.wrapOn +
        ansi.cursorShow +
        ansi.altScreenOff,
    );
    if (this.inp.isTTY) this.inp.setRawMode(false);
    this.inp.pause();
    process.off("exit", this.leave);
    process.off("SIGTERM", this.onSignal);
    process.off("SIGHUP", this.onSignal);
    process.off("uncaughtException", this.onCrash);
    process.off("unhandledRejection", this.onCrash);
  };

  /** Ctrl+Z: raw mode disables the kernel's job control, so restore the terminal and stop ourselves. */
  suspend(onResume: () => void): void {
    this.leave();
    process.once("SIGCONT", () => {
      this.enter();
      onResume();
    });
    process.kill(process.pid, "SIGTSTP");
  }

  write(s: string): void {
    if (s) this.out.write(s);
  }

  onResize(cb: () => void): () => void {
    this.out.on("resize", cb);
    return () => this.out.off("resize", cb);
  }

  onData(cb: (data: string) => void): () => void {
    this.inp.on("data", cb);
    return () => this.inp.off("data", cb);
  }

  private onSignal = (sig: NodeJS.Signals): void => {
    this.leave();
    process.exit(128 + (constants.signals[sig] ?? 1));
  };

  private onCrash = (err: unknown): void => {
    this.leave();
    console.error(err);
    process.exit(1);
  };
}
