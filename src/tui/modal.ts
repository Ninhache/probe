import type { InputEvent, Key } from "./input";
import type { Rect } from "./layout";
import type { Screen } from "./screen";
import { defaultTheme as t } from "./theme";
import { box } from "./widgets";

export interface Modal {
  title: string;
  /** Wanted size including the border; shrunk to fit the screen. */
  size: { w: number; h: number };
  /** Paint the content in the inner rect (the border and the title are already drawn). */
  draw(screen: Screen, inner: Rect): void;
  /** First look at an event. Return true when handled; Esc then still closes if it returns false. */
  onEvent?(event: InputEvent, inner: Rect): boolean;
  footer?: string;
}

/** Where a modal of the wanted size lands: centered, never larger than the screen. */
export function modalRect(area: Rect, size: { w: number; h: number }): Rect {
  const w = Math.max(0, Math.min(size.w, area.w));
  const h = Math.max(0, Math.min(size.h, area.h));
  return { x: area.x + ((area.w - w) >> 1), y: area.y + ((area.h - h) >> 1), w, h };
}

/**
 * Open modals, bottom to top. The topmost owns the keyboard and the mouse: nothing reaches the
 * screen underneath while one is open. The background stays visible around the box.
 */
export class ModalStack {
  private readonly items: Modal[] = [];
  private lastArea: Rect = { x: 0, y: 0, w: 0, h: 0 };

  get depth(): number {
    return this.items.length;
  }

  get top(): Modal | undefined {
    return this.items[this.items.length - 1];
  }

  push(modal: Modal): void {
    this.items.push(modal);
  }

  pop(): Modal | undefined {
    return this.items.pop();
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Paint every modal, oldest first, so a later one covers an earlier one. */
  draw(screen: Screen, area: Rect): void {
    this.lastArea = area;
    this.items.forEach((modal, index) => {
      const r = modalRect(area, modal.size);
      screen.fill(r, " ");
      const inner = box(screen, r, {
        title: modal.title,
        footer: modal.footer,
        color: index === this.items.length - 1 ? t.borderFocus : t.border,
        titleColor: t.title,
      });
      modal.draw(screen, inner);
    });
  }

  /** Give an event to the topmost modal. Returns false only when no modal is open. */
  handle(event: InputEvent): boolean {
    const modal = this.top;
    if (!modal) return false;
    const inner = innerOf(modalRect(this.lastArea, modal.size));
    if (modal.onEvent?.(event, inner)) return true;
    if (event.kind === "key" && isEscape(event)) this.pop();
    return true;
  }
}

const isEscape = (event: Key): boolean => event.name === "escape" && !event.ctrl && !event.alt;
const innerOf = (r: Rect): Rect => ({
  x: r.x + 1,
  y: r.y + 1,
  w: Math.max(0, r.w - 2),
  h: Math.max(0, r.h - 2),
});
