import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "../checkers/types";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import { createColors } from "../ui/colors";
import { formatCheckResults } from "../ui/report";
import { type Terminal, truncate } from "../ui/terminal";
import { EMPTY_FORM, type FormValues, formFields, formProblem, formRows, formValues } from "./form";
import { HELP_GAP, type HelpLine, helpBar, helpColumns, type Screen } from "./keymap";
import { type Keystroke, splitKeys, typedCharacter } from "./keys";
import type { Saved } from "./saves";
import { type DashboardSettings, SETTING_ROWS, stepChoice, stepServiceTimeout } from "./settings";

export interface DashboardProps {
  terminal: Terminal;
  /** Settings the dashboard starts with; the options panel changes them while it runs. */
  settings: DashboardSettings;
  /** Services set aside when the dashboard opens; the service panel changes them while it runs. */
  skipped?: Iterable<string>;
  /** Timeout of the services that set their own, in seconds; the service panel changes them. */
  timeouts?: ServiceTimeouts;
  /**
   * Runs one pass of checks, leaving the `skipped` services unchecked. `timeoutMs` is for the
   * services absent from `timeouts`. The signal aborts when the dashboard closes or a setting changes.
   */
  check: (
    signal: AbortSignal,
    timeoutMs: number,
    skipped: ReadonlySet<string>,
    timeouts: ServiceTimeouts,
  ) => Promise<CheckResult[]>;
  /** Called each time the service panel sets a timeout, in seconds; `undefined`: back to the default. */
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  /** Called with the new settings each time the options panel changes one. */
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  /** Called each time the service panel sets a service aside or brings it back. */
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
  /** Opens the URL of a service; resolves to the line that says what happened. */
  onOpen?: (name: string) => Promise<string>;
  /**
   * Copies the curl command of a service, with the timeout it has now, in seconds.
   * Resolves to the line that says what happened: the command itself when it could not be copied.
   */
  onCopy?: (name: string, timeout: number | undefined) => Promise<string>;
  /** What a service has now, to fill the form that edits it. */
  serviceFields?: (name: string) => ServiceFields | undefined;
  /**
   * Adds, edits or removes a service in the config. Resolves to why it was not saved, or to a
   * warning to show next to what was done. Unset: the keys that change the config do nothing.
   */
  onServiceWrite?: (write: ServiceWrite) => Promise<ServiceWriteOutcome>;
}

export interface ServiceWriteOutcome {
  /** False: the config was left as it was. */
  saved: boolean;
  /** What is not saved at this point, this write or an earlier change. */
  failure?: string;
  /** Something to say next to what was done. */
  warning?: string;
}

export type ServiceTimeouts = Readonly<Record<string, number | undefined>>;

/** The panel open under the list: the options, or the settings of one service. */
type Panel = { kind: "options"; row: number } | { kind: "service"; name: string; row: number };

/** What takes the keys over the list: the question before a removal, or the form of a service. */
type Dialog =
  | { kind: "confirm"; name: string }
  | { kind: "form"; editing?: string; row: number; values: FormValues; problem?: string };

const SERVICE_ROWS = ["Skip", "Timeout"];
const TIMEOUT_ROW = SERVICE_ROWS.indexOf("Timeout");
const NO_TIMEOUTS: ServiceTimeouts = {};

const MARKER_WIDTH = 2;
const PANEL_WIDTH = 30;
const FORM_WIDTH = 48;
// Where the next character goes in a text field.
const CURSOR = "_";
// Border and padding on both sides of a panel line.
const PANEL_FRAME_WIDTH = 4;

const seconds = (ms: number) => `${ms / 1000}s`;

/** The last `max` characters of a text, the cut shown at its start. */
function ending(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return max <= 1 ? "…" : `…${characters.slice(characters.length - max + 1).join("")}`;
}

/**
 * Live list of the services, checked again `intervalMs` after each pass ends; `o` opens the options,
 * enter the settings of the selected service, `u` its URL in the browser, `c` copies its curl
 * command, `/` filters by name, `a` `e` `d` add, edit and remove a service, `?` lists every key.
 * Colours come from `terminal`, never from ink props: ink does not honour `NO_COLOR`.
 */
export function Dashboard({
  terminal,
  settings: initial,
  skipped: initiallySkipped,
  timeouts: initialTimeouts = NO_TIMEOUTS,
  check,
  onSettingsChange,
  onSkipChange,
  onTimeoutChange,
  onOpen,
  onCopy,
  serviceFields,
  onServiceWrite,
}: DashboardProps) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [latest, setLatest] = useState<CheckResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [settings, setSettings] = useState(initial);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set(initiallySkipped));
  const [timeouts, setTimeouts] = useState(initialTimeouts);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [filter, setFilter] = useState("");
  // The filter is being typed: letters go to it, not to the keys of the list.
  const [filtering, setFiltering] = useState(false);
  // Counts the writes to the config: each one starts a new pass, on the services as they are now.
  const [writes, setWrites] = useState(0);
  const [help, setHelp] = useState(false);
  const [unsaved, setUnsaved] = useState<string>();
  // What the last `u` or `c` did, until the next key.
  const [notice, setNotice] = useState<string>();
  const skipPause = useRef(() => {});
  // A change stays in effect for this run even when saving it failed: the failure is shown instead.
  const track = (saved: Saved | undefined) => {
    void saved?.then(setUnsaved);
  };
  const { intervalMs, timeoutMs } = settings;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a write to the config starts a new pass
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loop = async () => {
      while (!signal.aborted) {
        const next = await check(signal, timeoutMs, skipped, timeouts);
        if (signal.aborted) return;
        setLatest(next);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, intervalMs);
          skipPause.current = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", skipPause.current, { once: true });
        });
      }
    };
    void loop();
    return () => controller.abort();
  }, [check, intervalMs, timeoutMs, skipped, timeouts, writes]);

  const wanted = filter.toLowerCase();
  // The services on screen: what the keys act on is what is drawn.
  const shown = (latest ?? []).filter(({ name }) => name.toLowerCase().includes(wanted));
  const last = Math.max(0, shown.length - 1);
  const current = Math.min(selected, last);

  const write = async (change: ServiceWrite, done: string) => {
    const outcome = await onServiceWrite?.(change);
    if (!outcome) return;
    setUnsaved(outcome.failure);
    if (!outcome.saved) return;
    setNotice(outcome.warning ? `${done}\n${outcome.warning}` : done);
    if (change.kind === "remove") {
      setLatest((results) => results?.filter(({ name }) => name !== change.name) ?? null);
      // A service added later under the same name starts without the timeout of this one.
      setTimeouts(({ [change.name]: _, ...others }) => others);
    }
    setWrites((count) => count + 1);
  };

  const typeInForm = (form: Dialog & { kind: "form" }, keystroke: Keystroke) => {
    const { key } = keystroke;
    const rows = formRows(form.editing === undefined);
    const field = rows[form.row]?.key;
    const typed = typedCharacter(keystroke);
    const edit = (value: string) =>
      field &&
      setDialog({ ...form, values: { ...form.values, [field]: value }, problem: undefined });
    if (key === "escape") setDialog(null);
    else if (key === "up") setDialog({ ...form, row: Math.max(0, form.row - 1) });
    else if (key === "down") setDialog({ ...form, row: Math.min(rows.length - 1, form.row + 1) });
    else if (key === "tab") setDialog({ ...form, row: (form.row + 1) % rows.length });
    else if (key === "backspace" && field) edit(form.values[field].slice(0, -1));
    else if (typed && field) edit(form.values[field] + typed);
    else if (key === "return") {
      const taken = (latest ?? []).map(({ name }) => name);
      const problem = formProblem(rows, form.values, taken);
      if (problem) return setDialog({ ...form, row: problem.row, problem: problem.message });
      setDialog(null);
      const fields = formFields(form.values);
      if (form.editing === undefined)
        void write({ kind: "add", name: form.values.name, fields }, `Added ${form.values.name}`);
      else void write({ kind: "edit", name: form.editing, fields }, `Saved ${form.editing}`);
    }
  };

  const typeFilter = (keystroke: Keystroke) => {
    const { key } = keystroke;
    const typed = typedCharacter(keystroke);
    if (key === "escape") {
      setFilter("");
      setFiltering(false);
    } else if (key === "return") setFiltering(false);
    else if (key === "backspace") setFilter(filter.slice(0, -1));
    else if (key === "up") setSelected(Math.max(0, current - 1));
    else if (key === "down") setSelected(Math.min(last, current + 1));
    else if (typed) setFilter(filter + typed);
  };

  const change = (rowIndex: number, direction: 1 | -1) => {
    const row = SETTING_ROWS[rowIndex];
    if (!row) return;
    const value = stepChoice(row.choicesMs, settings[row.key], direction);
    if (value === settings[row.key]) return;
    const next = { ...settings, [row.key]: value };
    setSettings(next);
    track(onSettingsChange?.(next));
  };

  const toggleSkip = (name: string) => {
    const next = new Set(skipped);
    const skip = !next.delete(name);
    if (skip) next.add(name);
    setSkipped(next);
    track(onSkipChange?.(name, skip));
  };

  const changeTimeout = (name: string, direction: 1 | -1) => {
    const value = stepServiceTimeout(timeouts[name], direction);
    if (value === timeouts[name]) return;
    setTimeouts({ ...timeouts, [name]: value });
    track(onTimeoutChange?.(name, value));
  };

  const press = (keystroke: Keystroke) => {
    const { input, key } = keystroke;
    const up = key === "up" || input === "k";
    const down = key === "down" || input === "j";
    const left = key === "left" || input === "h";
    const right = key === "right" || input === "l";
    const enter = key === "return";
    const selectedName = shown[current]?.name;
    setNotice(undefined);
    // A text field takes every character: there `q`, `?` and `j` are letters.
    if (dialog?.kind === "form") typeInForm(dialog, keystroke);
    else if (dialog) {
      setDialog(null);
      if (input === "y")
        void write({ kind: "remove", name: dialog.name }, `Removed ${dialog.name}`);
    } else if (filtering) typeFilter(keystroke);
    else if (input === "q") exit();
    else if (help) {
      if (input === "?" || key === "escape") setHelp(false);
    } else if (input === "?") setHelp(true);
    else if (panel === null) {
      if (input === "r") skipPause.current();
      else if (input === "o") setPanel({ kind: "options", row: 0 });
      else if (enter && selectedName) setPanel({ kind: "service", name: selectedName, row: 0 });
      else if (input === "u" && selectedName) void onOpen?.(selectedName).then(setNotice);
      else if (input === "c" && selectedName)
        void onCopy?.(selectedName, timeouts[selectedName]).then(setNotice);
      else if (input === "/") setFiltering(true);
      else if (key === "escape") setFilter("");
      else if (input === "a" && onServiceWrite)
        setDialog({ kind: "form", row: 0, values: EMPTY_FORM });
      else if (input === "e" && onServiceWrite && selectedName) {
        const fields = serviceFields?.(selectedName);
        if (fields)
          setDialog({ kind: "form", editing: selectedName, row: 0, values: formValues(fields) });
      } else if (input === "d" && onServiceWrite && selectedName)
        setDialog({ kind: "confirm", name: selectedName });
      else if (up) setSelected(Math.max(0, current - 1));
      else if (down) setSelected(Math.min(last, current + 1));
    } else if (key === "escape" || (panel.kind === "options" ? input === "o" : enter))
      setPanel(null);
    else if (up || down) {
      const lastRow = (panel.kind === "options" ? SETTING_ROWS : SERVICE_ROWS).length - 1;
      setPanel({ ...panel, row: Math.max(0, Math.min(lastRow, panel.row + (down ? 1 : -1))) });
    } else if (left || right) {
      if (panel.kind === "options") change(panel.row, right ? 1 : -1);
      else if (panel.row === TIMEOUT_ROW) changeTimeout(panel.name, right ? 1 : -1);
      else toggleSkip(panel.name);
    }
  };

  // Several keys can arrive before the next render, in one string or one after the other. `press`
  // belongs to a render: it is used only while no key was handled since that render, so a key
  // always sees what the key before it changed. Otherwise the key waits for the next render.
  const waiting = useRef<Keystroke[]>([]);
  const handledKeys = useRef(0);
  const seenKeys = handledKeys.current;
  const [, redraw] = useState(0);
  const handle = (keystroke: Keystroke) => {
    press(keystroke);
    handledKeys.current += 1;
  };
  useEffect(() => {
    if (seenKeys !== handledKeys.current) return;
    const next = waiting.current.shift();
    if (!next) return;
    handle(next);
    redraw((count) => count + 1);
  });
  useInput((input, key) => {
    const keys = splitKeys(input, key);
    const fresh = seenKeys === handledKeys.current && waiting.current.length === 0;
    const first = fresh ? keys.shift() : undefined;
    if (first) handle(first);
    waiting.current.push(...keys);
    redraw((count) => count + 1);
  });

  const colors = createColors(terminal.color);
  const { unicode } = terminal;
  const dot = unicode ? "·" : "-";
  const marker = unicode ? "› " : "> ";
  const cut = (text: string) => truncate(text, Math.max(1, columns));

  if (help) {
    const [left = [], right = []] = helpColumns(unicode, columns);
    const leftWidth = Math.max(...left.map(({ text }) => text.length));
    const paint = (line: HelpLine | undefined) =>
      line?.heading ? colors.bold(cut(line.text)) : cut(line?.text ?? "");
    const lines = Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
      const near = left[index];
      const far = right[index];
      const gap = " ".repeat(leftWidth - (near?.text.length ?? 0) + HELP_GAP);
      return {
        id: near?.id ?? far?.id,
        text: far ? `${paint(near)}${gap}${paint(far)}` : paint(near),
      };
    });
    return (
      <Box flexDirection="column">
        <Text>{colors.bold(cut(`probe ${dot} keys`))}</Text>
        {lines.map(({ id, text }) => (
          <Text key={id}>{text}</Text>
        ))}
        <Text>{colors.dim(cut(helpBar("help", unicode, columns)))}</Text>
      </Box>
    );
  }

  if (!latest) return <Text>{cut("probe: checking…")}</Text>;

  // A service just set aside is shown as such at once, not when the pass that skips it ends.
  const results = shown.map((result): CheckResult => {
    if (result.skipped || !skipped.has(result.name)) return result;
    const { name, type, target } = result;
    return { name, type, target, ok: true, skipped: true, latencyMs: 0 };
  });

  const all = latest.filter((result) => !result.skipped && !skipped.has(result.name));
  const up = all.filter((result) => result.ok).length;
  const aside = latest.length - all.length;
  const summary = [
    "probe",
    `${up}/${all.length} up`,
    ...(aside > 0 ? [`${aside} skipped`] : []),
    `every ${seconds(intervalMs)}`,
    ...(filter && !filtering ? [`filter: ${filter}`] : []),
  ].join(` ${dot} `);
  const rows =
    results.length === 0
      ? []
      : formatCheckResults(results, {
          ...terminal,
          columns: Math.max(1, columns - MARKER_WIDTH),
        }).split("\n");
  const empty = filter
    ? `no service matches "${filter}"`
    : onServiceWrite
      ? "no service: press a to add one"
      : "no service";
  const focused = results[current];
  const panelWidth = Math.min(PANEL_WIDTH, columns);
  const panelRows: [label: string, value: string][] =
    panel?.kind === "options"
      ? SETTING_ROWS.map((row) => [row.label, seconds(settings[row.key])])
      : panel
        ? [
            ["Skip", skipped.has(panel.name) ? "yes" : "no"],
            [
              "Timeout",
              timeouts[panel.name] === undefined ? "default" : `${timeouts[panel.name]}s`,
            ],
          ]
        : [];
  const labelWidth = Math.max(0, ...panelRows.map(([label]) => label.length));
  const screen: Screen =
    dialog?.kind === "form"
      ? "form"
      : dialog
        ? "confirm"
        : filtering
          ? "filter"
          : panel
            ? "panel"
            : "list";
  const hint = helpBar(screen, unicode, columns);
  const formWidth = Math.min(FORM_WIDTH, columns);
  const formLabels = dialog?.kind === "form" ? formRows(dialog.editing === undefined) : [];
  const formLabelWidth = Math.max(0, ...formLabels.map(({ label }) => label.length));

  return (
    <Box flexDirection="column">
      <Text>{colors.bold(cut(summary))}</Text>
      {rows.map((row, index) => (
        <Text key={results[index]?.name}>
          {index === current ? marker : "  "}
          {row}
        </Text>
      ))}
      {rows.length === 0 && <Text>{colors.dim(cut(empty))}</Text>}
      {focused && (
        <Text>
          {colors.dim(
            cut(focused.error ? `${focused.target} ${dot} ${focused.error}` : focused.target),
          )}
        </Text>
      )}
      {panel !== null && (
        <Box
          flexDirection="column"
          width={panelWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>
            {colors.bold(
              truncate(
                panel.kind === "options" ? "Options" : panel.name,
                Math.max(1, panelWidth - PANEL_FRAME_WIDTH),
              ),
            )}
          </Text>
          {panelRows.map(([label, value], index) => {
            const line = `${index === panel.row ? marker : "  "}${label.padEnd(labelWidth)}  ${
              unicode ? `‹ ${value} ›` : `< ${value} >`
            }`;
            return (
              <Text key={label}>{truncate(line, Math.max(1, panelWidth - PANEL_FRAME_WIDTH))}</Text>
            );
          })}
        </Box>
      )}
      {filtering && <Text>{cut(`Filter: ${filter}${CURSOR}`)}</Text>}
      {dialog?.kind === "confirm" && (
        <Text>{colors.bold(cut(`Remove ${dialog.name} from the config?`))}</Text>
      )}
      {dialog?.kind === "form" && (
        <Box
          flexDirection="column"
          width={formWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>
            {colors.bold(
              truncate(
                dialog.editing === undefined ? "Add a service" : `Edit ${dialog.editing}`,
                Math.max(1, formWidth - PANEL_FRAME_WIDTH),
              ),
            )}
          </Text>
          {formLabels.map(({ key, label, placeholder }, index) => {
            const active = index === dialog.row;
            const value = dialog.values[key];
            const room = Math.max(1, formWidth - PANEL_FRAME_WIDTH);
            const prefix = `${active ? marker : "  "}${label.padEnd(formLabelWidth)}  `;
            // The field being typed shows its end, where the next character goes.
            const typed = active
              ? `${prefix}${ending(value, Math.max(1, room - prefix.length - CURSOR.length))}${CURSOR}`
              : truncate(`${prefix}${value}`, room);
            const example = value
              ? ""
              : truncate(placeholder, Math.max(0, room - typed.length - 1));
            return (
              <Text key={key}>
                {typed}
                {example && colors.dim(`${active ? " " : ""}${example}`)}
              </Text>
            );
          })}
          {dialog.problem !== undefined && <Text>{colors.yellow(dialog.problem)}</Text>}
        </Box>
      )}
      {/* Not cut: a command that could not be copied must be readable whole. */}
      {notice !== undefined && <Text>{notice}</Text>}
      {unsaved !== undefined && <Text>{colors.yellow(cut(`not saved: ${unsaved}`))}</Text>}
      <Text>{colors.dim(cut(hint))}</Text>
    </Box>
  );
}
