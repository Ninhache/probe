/** Raw escape sequences. Everything a TUI does is one of these strings written to stdout. */
export const ESC = "\x1b[";

export const ansi = {
  /** Move the cursor. Takes 0-based (row, col); the terminal itself is 1-based. */
  moveTo: (row: number, col: number): string => `${ESC}${row + 1};${col + 1}H`,
  reset: `${ESC}0m`,
  clear: `${ESC}2J`,
  /** Alternate screen: a separate buffer, the shell is restored untouched on exit. */
  altScreenOn: `${ESC}?1049h`,
  altScreenOff: `${ESC}?1049l`,
  cursorHide: `${ESC}?25l`,
  cursorShow: `${ESC}?25h`,
  /** Auto-wrap off: writing in the last column never scrolls the screen. */
  wrapOff: `${ESC}?7l`,
  wrapOn: `${ESC}?7h`,
  /** Synchronized output (DEC 2026): the terminal shows the frame only once it is complete, no tearing. */
  syncStart: `${ESC}?2026h`,
  syncEnd: `${ESC}?2026l`,
  /** Mouse: 1000 = clicks, 1002 = drag, 1006 = SGR encoding (no 223-column limit). */
  mouseOn: `${ESC}?1000h${ESC}?1002h${ESC}?1006h`,
  mouseOff: `${ESC}?1006l${ESC}?1002l${ESC}?1000l`,
} as const;
