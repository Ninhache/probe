import { ansi } from "./ansi";
import { detectColorMode } from "./color";
import { type InputEvent, parseInput } from "./input";
import type { Rect } from "./layout";
import { Screen } from "./screen";
import { Terminal } from "./terminal";

export type AppOptions = {
  /** Draw the whole UI from current state. Called on each frame; must be fast and side-effect free. */
  render: (screen: Screen, area: Rect) => void;
  onInput?: (ev: InputEvent, app: App) => void;
  /** Called after the terminal is restored (stop timers, close sockets...). */
  onStop?: () => void;
  /** Upper bound on frames per second; extra render requests are merged. */
  maxFps?: number;
  /** Redraw every N ms even if nothing asked (clocks, spinners). 0 = off. */
  tickMs?: number;
  mouse?: boolean;
  /** Below this size, show a "terminal too small" message instead of a broken layout. */
  minSize?: { w: number; h: number };
};

/** Glues Terminal + Screen + input together and schedules frames. */
export class App {
  readonly terminal: Terminal;
  readonly screen: Screen;
  frame = 0;
  private readonly opts: AppOptions;
  private scheduled = false;
  private stopped = false;
  private lastFrameAt = 0;
  private tick?: NodeJS.Timeout;

  constructor(opts: AppOptions) {
    this.opts = opts;
    this.terminal = new Terminal({ mouse: opts.mouse });
    this.screen = new Screen(this.terminal.cols, this.terminal.rows, detectColorMode());
  }

  start(): void {
    this.terminal.enter();
    this.terminal.onResize(() => {
      this.screen.resize(this.terminal.cols, this.terminal.rows);
      this.terminal.write(ansi.clear);
      this.requestRender();
    });
    this.terminal.onData((data) => {
      for (const ev of parseInput(data)) {
        if (ev.kind === "key" && ev.ctrl && ev.name === "c") return this.stop();
        if (ev.kind === "key" && ev.ctrl && ev.name === "z") {
          this.terminal.suspend(() => {
            this.screen.resize(this.terminal.cols, this.terminal.rows);
            this.redraw();
          });
          return;
        }
        this.opts.onInput?.(ev, this);
      }
      this.requestRender();
    });
    if (this.opts.tickMs) this.tick = setInterval(() => this.requestRender(), this.opts.tickMs);
    this.renderNow();
  }

  /** Ask for a frame. Cheap, call it whenever state changes: calls are merged and rate-limited. */
  requestRender(): void {
    if (this.scheduled || this.stopped) return;
    this.scheduled = true;
    const minGap = 1000 / (this.opts.maxFps ?? 30);
    const wait = Math.max(0, this.lastFrameAt + minGap - performance.now());
    setTimeout(() => {
      this.scheduled = false;
      this.renderNow();
    }, wait);
  }

  /** Repaint every cell (the terminal content is unknown, e.g. after resuming from Ctrl+Z). */
  redraw(): void {
    this.screen.invalidate();
    this.requestRender();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.tick);
    this.terminal.leave();
    this.opts.onStop?.();
  }

  private renderNow(): void {
    if (this.stopped) return;
    this.lastFrameAt = performance.now();
    this.frame++;
    const s = this.screen;
    s.clear();
    const min = this.opts.minSize;
    if (min && (s.width < min.w || s.height < min.h)) {
      const msg = `Terminal too small: ${s.width}x${s.height}, need ${min.w}x${min.h}`;
      s.text(Math.max(0, (s.width - msg.length) >> 1), s.height >> 1, msg, { bold: true });
    } else {
      this.opts.render(s, { x: 0, y: 0, w: s.width, h: s.height });
    }
    const diff = s.flush();
    if (diff) this.terminal.write(ansi.syncStart + diff + ansi.syncEnd);
  }
}
