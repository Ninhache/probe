import type { InputEvent } from "../../tui/input";
import type { Rect } from "../../tui/layout";
import type { ModalStack } from "../../tui/modal";
import type { Screen } from "../../tui/screen";
import { drawField, fieldKey, fieldValue, type TextField, textField } from "../../tui/textfield";
import { defaultTheme as t } from "../../tui/theme";
import { graphemes, pad, strWidth } from "../../tui/width";
import { nextChoice } from "../choice";
import type { Panel } from "./panels";

const MARKER = "› ";
const LABEL_GAP = 2;
const FRAME_ROWS = 2;
const CHOICE_OPEN = "‹ ";
const CHOICE_CLOSE = " ›";

/** One line of a form: a text field, or a choice among words. */
export interface FormLine {
  /** Unique among the lines; the value of the line is kept under it, even while the line is hidden. */
  id: string;
  label: string;
  placeholder?: string;
  choices?: readonly string[];
  /** The text drawn in place of the typed one: a header line hides its secret. */
  shown?: (value: string) => string;
  /** Drawn dimmed: the line is not used for now. */
  muted?: boolean;
}

export interface FormLayout {
  lines: readonly FormLine[];
  /** Dimmed lines under the fields. */
  notes?: readonly string[];
}

export type FormValues = Readonly<Record<string, string>>;

/** What a submit can do to its form once it has looked at the values. */
export interface FormHandle {
  /** The line the problem is about gets the cursor; its message is drawn under the form. */
  problem(id: string | undefined, message: string): void;
  /** Keys are ignored while something is being written or looked up. */
  busy(on: boolean): void;
  /** Replaces typed values: the secret step swaps a typed secret for its reference. */
  set(values: FormValues): void;
  close(): void;
  readonly stack: ModalStack;
}

export interface FormOptions {
  title: string;
  /** Wanted width, border included. */
  width: number;
  values: FormValues;
  layout(values: FormValues, active: string | undefined): FormLayout;
  submit(values: FormValues, form: FormHandle): void;
  stack: ModalStack;
  /** Asks the screen for a new frame after something that did not come from a key. */
  redraw?: () => void;
}

export type FormModal = Panel & {
  /** The values as typed now. */
  values(): FormValues;
  /** Gives the form its handle, for a step that returns to it (the secret step). */
  readonly handle: FormHandle;
};

/** The text drawn for a line: the typed one, or what `shown` makes of it. */
function drawn(line: FormLine, field: TextField): TextField {
  if (!line.shown) return field;
  const chars = graphemes(line.shown(fieldValue(field)));
  return { ...field, chars, cursor: Math.min(field.cursor, chars.length) };
}

/**
 * A modal of labelled lines. The lines come from `layout`, called again at each key: a choice or a
 * typed value can add or remove lines. Every line keeps its own field and caret.
 */
export function formModal(options: FormOptions): FormModal {
  const fields = new Map<string, TextField>();
  let row = 0;
  let problem: string | undefined;
  let waiting = false;
  const field = (id: string): TextField => {
    const known = fields.get(id);
    if (known) return known;
    const created = textField(options.values[id] ?? "");
    fields.set(id, created);
    return created;
  };
  const values = (): FormValues => ({
    ...options.values,
    ...Object.fromEntries([...fields].map(([id, state]) => [id, fieldValue(state)])),
  });
  const layout = () => {
    const now = values();
    const first = options.layout(now, undefined);
    row = Math.max(0, Math.min(row, first.lines.length - 1));
    return options.layout(now, first.lines[row]?.id);
  };
  const handle: FormHandle = {
    problem(id, message) {
      problem = message;
      const at = layout().lines.findIndex((line) => line.id === id);
      if (at >= 0) row = at;
      options.redraw?.();
    },
    busy(on) {
      waiting = on;
      options.redraw?.();
    },
    set(next) {
      for (const [id, value] of Object.entries(next)) fields.set(id, textField(value));
    },
    close: () => {
      options.stack.pop();
    },
    stack: options.stack,
  };
  const labelWidth = (lines: readonly FormLine[]) =>
    Math.max(...lines.map((line) => strWidth(line.label)), 1);
  const notes = (shown: FormLayout) => (problem ? 1 : 0) + (shown.notes?.length ?? 0);

  const modal: FormModal = {
    title: options.title,
    bar: "form",
    typing: true,
    handle,
    values,
    get size() {
      const shown = layout();
      return { w: options.width, h: shown.lines.length + notes(shown) + FRAME_ROWS };
    },
    draw(screen: Screen, inner: Rect) {
      const shown = layout();
      const room = Math.max(1, inner.h - notes(shown));
      const first = Math.max(0, Math.min(row - room + 1, shown.lines.length - room));
      const width = labelWidth(shown.lines);
      shown.lines.slice(first, first + room).forEach((line, i) => {
        const y = inner.y + i;
        const active = first + i === row;
        const style = line.muted ? { fg: t.muted } : { fg: t.fg };
        const prefix = `${active ? MARKER : "  "}${pad(line.label, width)}${" ".repeat(LABEL_GAP)}`;
        const x = inner.x + 1 + screen.text(inner.x + 1, y, prefix, style, inner.w - 1);
        const room = inner.x + inner.w - x - 1;
        const state = field(line.id);
        if (line.choices) {
          const value = fieldValue(state) || (line.choices[0] ?? "");
          screen.text(x, y, `${CHOICE_OPEN}${value}${CHOICE_CLOSE}`, { fg: t.accent }, room);
          return;
        }
        const display = drawn(line, state);
        if (!fieldValue(state) && !active) {
          screen.text(x, y, line.placeholder ?? "", { fg: t.muted }, room);
        } else if (active) {
          const next = drawField(screen, x, y, room, display, style);
          fields.set(line.id, { ...state, offset: next.offset });
          if (!fieldValue(state) && line.placeholder)
            screen.text(x + 1, y, line.placeholder, { fg: t.muted }, room - 1);
        } else screen.text(x, y, display.chars.join(""), style, room);
      });
      let y = inner.y + Math.min(room, shown.lines.length);
      for (const note of shown.notes ?? []) {
        screen.text(inner.x + 1, y, note, { fg: t.muted }, inner.w - 2);
        y += 1;
      }
      if (problem) screen.text(inner.x + 1, y, problem, { fg: t.warn }, inner.w - 2);
    },
    onEvent(event: InputEvent) {
      if (event.kind !== "key") return true;
      if (waiting) return true;
      const shown = layout();
      const line = shown.lines[row];
      if (event.name === "escape" && !event.ctrl && !event.alt) return false;
      if (event.ctrl || event.alt) {
        if (line && !line.choices) edit(line, fieldKey(field(line.id), event));
        return true;
      }
      const last = shown.lines.length - 1;
      if (event.name === "up") row = Math.max(0, row - 1);
      else if (event.name === "down") row = Math.min(last, row + 1);
      else if (event.name === "tab") row = (row + (event.shift ? last : 1)) % (last + 1);
      else if (event.name === "enter") {
        problem = undefined;
        options.submit(values(), handle);
      } else if (line?.choices) {
        const text = fieldValue(field(line.id)) || (line.choices[0] ?? "");
        const letter = event.raw.length === 1 && event.raw >= " " ? event.raw : undefined;
        const step: 1 | -1 | string | undefined =
          event.name === "left" ? -1 : event.name === "right" ? 1 : letter;
        if (step !== undefined) edit(line, textField(nextChoice(line.choices, text, step)));
      } else if (line) edit(line, fieldKey(field(line.id), event));
      return true;
    },
  };

  function edit(line: FormLine, next: TextField) {
    if (next === fields.get(line.id)) return;
    const changed = fieldValue(next) !== fieldValue(field(line.id));
    fields.set(line.id, next);
    if (changed) problem = undefined;
  }
  return modal;
}
