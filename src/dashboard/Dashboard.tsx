import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "../checkers/types";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import { hiddenHeaderLine, serviceVariables, variableValueProblem } from "../config/headers";
import { CONFIG_FILE, LOCAL_FILE, PROBE_DIR } from "../constants";
import { createColors } from "../ui/colors";
import { formatCheckResults } from "../ui/report";
import { type Terminal, truncate } from "../ui/terminal";
import { changeMessage, type KnownStates, stateChanges } from "./changes";
import { detailLines, type LatencyHistory, recordLatencies } from "./detail";
import {
  EMPTY_FORM,
  type FormSecret,
  type FormValues,
  formFields,
  formProblem,
  formRows,
  formSecret,
  formValues,
  formVariables,
  HEADER_LABEL,
  HEADER_PLACEHOLDER,
  withHeaderLine,
  withVariable,
} from "./form";
import {
  type Command,
  HELP_GAP,
  type HelpLine,
  helpBar,
  helpColumns,
  keyCommand,
  paletteEntries,
  type Screen,
} from "./keymap";
import { type Keystroke, splitKeys, typedCharacter } from "./keys";
import type { Saved } from "./saves";
import { type DashboardSettings, SETTING_ROWS, stepChoice, stepServiceTimeout } from "./settings";
import type { VariableRow, VariableTools } from "./variables";

export interface DashboardProps {
  terminal: Terminal;
  settings: DashboardSettings;
  skipped?: Iterable<string>;
  timeouts?: ServiceTimeouts;
  check: (
    signal: AbortSignal,
    timeoutMs: number,
    skipped: ReadonlySet<string>,
    timeouts: ServiceTimeouts,
  ) => Promise<CheckResult[]>;
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
  onOpen?: (name: string) => Promise<string>;
  onCopy?: (name: string, timeout: number | undefined) => Promise<string>;
  onNotify?: (message: string) => Promise<string | undefined>;
  serviceFields?: (name: string) => ServiceFields | string | undefined;
  /** `secrets`: variable name to value, kept on this machine once the service is written. */
  onServiceWrite?: (write: ServiceWrite, secrets?: Secrets) => Promise<ServiceWriteOutcome>;
  variables?: VariableTools;
  onVariableWrite?: (name: string, value: string) => Saved;
}

export type Secrets = Readonly<Record<string, string>>;

export interface ServiceWriteOutcome {
  saved: boolean;
  failure?: string;
  warning?: string;
}

export type ServiceTimeouts = Readonly<Record<string, number | undefined>>;

type Panel = { kind: "options"; row: number } | { kind: "service"; name: string; row: number };

interface Form {
  kind: "form";
  editing?: string;
  row: number;
  values: FormValues;
  problem?: string;
  secrets?: Secrets;
}

// `variable` is unset while a name is being looked for.
type SecretStep = FormSecret & { kind: "secret"; form: Form; variable?: string; problem?: string };

type Dialog =
  | { kind: "confirm"; name: string }
  | Form
  | SecretStep
  | { kind: "variable"; name: string; value: string; problem?: string };

interface Palette {
  query: string;
  row: number;
}

const SERVICE_ROWS = ["Skip", "Timeout"];
const NOTIFY_ROW = SETTING_ROWS.length;
const SKIP_ROW = SERVICE_ROWS.indexOf("Skip");
const TIMEOUT_ROW = SERVICE_ROWS.indexOf("Timeout");
const NO_TIMEOUTS: ServiceTimeouts = {};
const NO_VARIABLES: readonly VariableRow[] = [];
const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;
const SOURCES = { environment: "set in the environment", local: `set in ${LOCAL_FILE}` };

const MARKER_WIDTH = 2;
const PANEL_WIDTH = 30;
const DETAIL_WIDTH = 60;
// What the screen keeps around the detail when a terminal does not tell its height.
const DEFAULT_ROWS = 24;
const FORM_WIDTH = 48;
const CURSOR = "_";
const PANEL_FRAME_WIDTH = 4;

const seconds = (ms: number) => `${ms / 1000}s`;

function ending(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return max <= 1 ? "…" : `…${characters.slice(characters.length - max + 1).join("")}`;
}

// Colours come from `terminal`, never from ink props: ink does not honour `NO_COLOR`.
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
  onNotify,
  serviceFields,
  onServiceWrite,
  variables,
  onVariableWrite,
}: DashboardProps) {
  const { exit } = useApp();
  const { columns, rows: windowRows } = useWindowSize();
  const [latest, setLatest] = useState<CheckResult[] | null>(null);
  const [history, setHistory] = useState<LatencyHistory>({});
  const [selected, setSelected] = useState(0);
  const [settings, setSettings] = useState(initial);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set(initiallySkipped));
  const [timeouts, setTimeouts] = useState(initialTimeouts);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [palette, setPalette] = useState<Palette | null>(null);
  // Counts the writes to the config: each one starts a new pass, on the services as they are now.
  const [writes, setWrites] = useState(0);
  const [help, setHelp] = useState(false);
  const [unsaved, setUnsaved] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [variableRows, setVariableRows] = useState(NO_VARIABLES);
  const looking = useRef(false);
  const skipPause = useRef(() => {});
  // A change stays in effect for this run even when saving it failed: the failure is shown instead.
  const track = (saved: Saved | undefined) => {
    void saved?.then(setUnsaved);
  };
  const { intervalMs, timeoutMs } = settings;
  // Kept across passes and settings: a change is told once, and turning the notifications on tells nothing old.
  const known = useRef<KnownStates>(new Map());
  const notifying = useRef(false);
  notifying.current = settings.notify === true;
  const warned = useRef(false);
  const tell = (next: CheckResult[]) => {
    const { known: now, changes } = stateChanges(known.current, next);
    known.current = now;
    if (!notifying.current || changes.length === 0) return;
    // Not awaited: the checks go on whatever the desktop does.
    void onNotify?.(changeMessage(changes)).then((warning) => {
      if (warning === undefined || warned.current) return;
      warned.current = true;
      setNotice(warning);
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a write to the config starts a new pass
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loop = async () => {
      while (!signal.aborted) {
        const next = await check(signal, timeoutMs, skipped, timeouts);
        if (signal.aborted) return;
        setLatest(next);
        tell(next);
        setHistory((before) => recordLatencies(before, next));
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

  const detailedName = panel?.kind === "service" ? panel.name : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each pass may find a variable set meanwhile
  useEffect(() => {
    if (detailedName === undefined || !variables) return setVariableRows(NO_VARIABLES);
    let closed = false;
    void variables.serviceVariables(detailedName).then((found) => {
      if (!closed) setVariableRows(found);
    });
    return () => {
      closed = true;
    };
  }, [detailedName, variables, latest]);

  const wanted = filter.toLowerCase();
  const shown = (latest ?? []).filter(({ name }) => name.toLowerCase().includes(wanted));
  const last = Math.max(0, shown.length - 1);
  const current = Math.min(selected, last);

  const write = async (change: ServiceWrite, done: string, secrets?: Secrets) => {
    const outcome = await (secrets ? onServiceWrite?.(change, secrets) : onServiceWrite?.(change));
    if (!outcome) return;
    setUnsaved(outcome.failure);
    if (!outcome.saved) return;
    const kept = Object.keys(secrets ?? {});
    const told =
      kept.length > 0 && outcome.failure === undefined
        ? `${done}, ${kept.join(", ")} kept in ${LOCAL}`
        : done;
    setNotice(outcome.warning ? `${told}\n${outcome.warning}` : told);
    if (change.kind === "remove") {
      setLatest((results) => results?.filter(({ name }) => name !== change.name) ?? null);
      // A service added later under the same name starts without the timeout of this one.
      setTimeouts(({ [change.name]: _, ...others }) => others);
    }
    setWrites((count) => count + 1);
  };

  const submit = (form: Form) => {
    const rows = formRows(form.editing === undefined);
    const taken = (latest ?? []).map(({ name }) => name);
    const problem = formProblem(rows, form.values, taken);
    if (problem) return setDialog({ ...form, row: problem.row, problem: problem.message });
    const service = form.editing ?? form.values.name;
    const secret = formSecret(form.values);
    if (secret) {
      const row = rows.length + secret.index;
      if (!variables) {
        const message = `${secret.header} expects a reference, e.g. \${API_TOKEN}: config.yml is shared`;
        return setDialog({ ...form, row, problem: message });
      }
      const step: SecretStep = { kind: "secret", form: { ...form, row }, ...secret };
      setDialog(step);
      looking.current = true;
      const used = formVariables(form.values);
      return void variables.variableName(service, secret.header, used).then((variable) => {
        looking.current = false;
        setDialog({ ...step, variable });
      });
    }
    setDialog(null);
    const fields = formFields(form.values);
    // A secret named before its header was retyped or removed is kept nowhere.
    const sent = serviceVariables(fields.headers);
    const kept = Object.entries(form.secrets ?? {}).filter(([name]) => sent.includes(name));
    const secrets = kept.length > 0 ? Object.fromEntries(kept) : undefined;
    if (form.editing === undefined)
      void write({ kind: "add", name: service, fields }, `Added ${service}`, secrets);
    else void write({ kind: "edit", name: service, fields }, `Saved ${service}`, secrets);
  };

  const typeInForm = (form: Form, keystroke: Keystroke) => {
    const { key } = keystroke;
    const rows = formRows(form.editing === undefined);
    const field = rows[form.row]?.key;
    const header = form.row - rows.length;
    const lastRow = rows.length + form.values.headers.length;
    const typed = typedCharacter(keystroke);
    const value = field ? form.values[field] : (form.values.headers[header] ?? "");
    const edit = (next: string) =>
      setDialog({
        ...form,
        values: field
          ? { ...form.values, [field]: next }
          : withHeaderLine(form.values, header, next),
        problem: undefined,
      });
    if (key === "escape") setDialog(null);
    else if (key === "up") setDialog({ ...form, row: Math.max(0, form.row - 1) });
    else if (key === "down") setDialog({ ...form, row: Math.min(lastRow, form.row + 1) });
    else if (key === "tab") setDialog({ ...form, row: (form.row + 1) % (lastRow + 1) });
    else if (key === "backspace") edit(value.slice(0, -1));
    else if (key === "clear") edit("");
    else if (typed) edit(value + typed);
    else if (key === "return") submit(form);
  };

  const typeSecret = (step: SecretStep, keystroke: Keystroke) => {
    const { key } = keystroke;
    const { variable, form } = step;
    if (looking.current || variable === undefined) return;
    const typed = typedCharacter(keystroke);
    const rename = (next: string) => setDialog({ ...step, variable: next, problem: undefined });
    if (key === "escape") setDialog(form);
    else if (key === "backspace") rename(variable.slice(0, -1));
    else if (key === "clear") rename("");
    else if (typed) rename(variable + typed);
    else if (key === "return") {
      // Under a name another header of the form sends, that header would send this secret.
      if (formVariables(form.values).includes(variable))
        return setDialog({ ...step, problem: `${variable} already keeps another header` });
      looking.current = true;
      const service = form.editing ?? form.values.name;
      void variables?.variableProblem(variable, service).then((problem) => {
        looking.current = false;
        if (problem) return setDialog({ ...step, problem });
        submit({
          ...form,
          values: withVariable(form.values, step, variable),
          secrets: { ...form.secrets, [variable]: step.secret },
        });
      });
    }
  };

  const typeVariable = (asked: Dialog & { kind: "variable" }, keystroke: Keystroke) => {
    const { key } = keystroke;
    const { name, value } = asked;
    const typed = typedCharacter(keystroke);
    const retype = (next: string) => setDialog({ ...asked, value: next, problem: undefined });
    if (key === "escape") setDialog(null);
    else if (key === "backspace") retype(value.slice(0, -1));
    else if (key === "clear") retype("");
    else if (typed) retype(value + typed);
    else if (key === "return") {
      const problem = variableValueProblem(value);
      if (problem) return setDialog({ ...asked, problem: `${name} expects ${problem}` });
      setDialog(null);
      void onVariableWrite?.(name, value).then((failure) => {
        setUnsaved(failure);
        if (failure !== undefined) return;
        setNotice(`Kept ${name} in ${LOCAL}, for this machine only`);
        setWrites((count) => count + 1);
      });
    }
  };

  const askVariable = ({ name, source }: VariableRow) => {
    if (source === "environment")
      return setNotice(`${name} comes from the environment, which is read first`);
    setDialog({ kind: "variable", name, value: "" });
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
    if (!row && rowIndex !== NOTIFY_ROW) return;
    const next = row
      ? { ...settings, [row.key]: stepChoice(row.choicesMs, settings[row.key], direction) }
      : { ...settings, notify: !settings.notify };
    if (row && next[row.key] === settings[row.key]) return;
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

  const run = (command: Command) => {
    const name = shown[current]?.name;
    switch (command) {
      case "check":
        return skipPause.current();
      case "options":
        return setPanel({ kind: "options", row: 0 });
      case "detail":
        return name ? setPanel({ kind: "service", name, row: 0 }) : undefined;
      case "open":
        return name ? void onOpen?.(name).then(setNotice) : undefined;
      case "copy":
        return name ? void onCopy?.(name, timeouts[name]).then(setNotice) : undefined;
      case "filter":
        return setFiltering(true);
      case "add":
        return onServiceWrite ? setDialog({ kind: "form", row: 0, values: EMPTY_FORM }) : undefined;
      case "edit": {
        const fields = onServiceWrite && name ? serviceFields?.(name) : undefined;
        if (typeof fields === "string") return setNotice(fields);
        if (fields) setDialog({ kind: "form", editing: name, row: 0, values: formValues(fields) });
        return;
      }
      case "remove":
        return onServiceWrite && name ? setDialog({ kind: "confirm", name }) : undefined;
      case "help":
        return setHelp(true);
      case "quit":
        return exit();
      default:
        return command satisfies never;
    }
  };

  const typePalette = ({ query, row }: Palette, keystroke: Keystroke) => {
    const { key } = keystroke;
    const typed = typedCharacter(keystroke);
    const entries = paletteEntries(terminal.unicode, query);
    if (key === "escape") setPalette(null);
    else if (key === "return") {
      const entry = entries[row];
      if (!entry) return;
      setPalette(null);
      run(entry.command);
    } else if (key === "up") setPalette({ query, row: Math.max(0, row - 1) });
    else if (key === "down")
      setPalette({ query, row: Math.max(0, Math.min(entries.length - 1, row + 1)) });
    else if (key === "backspace") setPalette({ query: query.slice(0, -1), row: 0 });
    else if (typed) setPalette({ query: query + typed, row: 0 });
  };

  const press = (keystroke: Keystroke) => {
    const { input, key } = keystroke;
    const up = key === "up" || input === "k";
    const down = key === "down" || input === "j";
    const left = key === "left" || input === "h";
    const right = key === "right" || input === "l";
    const enter = key === "return";
    setNotice(undefined);
    // A text field takes every character: there `q`, `?` and `j` are letters.
    const variableRow =
      panel?.kind === "service" && onVariableWrite
        ? variableRows[panel.row - SERVICE_ROWS.length]
        : undefined;
    if (dialog?.kind === "form") typeInForm(dialog, keystroke);
    else if (dialog?.kind === "secret") typeSecret(dialog, keystroke);
    else if (dialog?.kind === "variable") typeVariable(dialog, keystroke);
    else if (dialog) {
      setDialog(null);
      if (input === "y")
        void write({ kind: "remove", name: dialog.name }, `Removed ${dialog.name}`);
    } else if (palette) typePalette(palette, keystroke);
    else if (filtering) typeFilter(keystroke);
    else if (input === "q") exit();
    else if (help) {
      if (input === "?" || key === "escape") setHelp(false);
    } else if (input === "?") setHelp(true);
    else if (panel === null) {
      const command = keyCommand(input, enter);
      if (command) run(command);
      else if (input === ":") setPalette({ query: "", row: 0 });
      else if (key === "escape") setFilter("");
      else if (up) setSelected(Math.max(0, current - 1));
      else if (down) setSelected(Math.min(last, current + 1));
    } else if (enter && variableRow) askVariable(variableRow);
    else if (key === "escape" || (panel.kind === "options" ? input === "o" : enter)) setPanel(null);
    else if (up || down) {
      const lastRow =
        panel.kind === "options" ? NOTIFY_ROW : SERVICE_ROWS.length + variableRows.length - 1;
      setPanel({ ...panel, row: Math.max(0, Math.min(lastRow, panel.row + (down ? 1 : -1))) });
    } else if (left || right) {
      if (panel.kind === "options") change(panel.row, right ? 1 : -1);
      else if (panel.row === TIMEOUT_ROW) changeTimeout(panel.name, right ? 1 : -1);
      else if (panel.row === SKIP_ROW) toggleSkip(panel.name);
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
  const asShown = (result: CheckResult): CheckResult => {
    if (result.skipped || !skipped.has(result.name)) return result;
    const { name, type, target } = result;
    return { name, type, target, ok: true, skipped: true, latencyMs: 0 };
  };
  const results = shown.map(asShown);

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
      : // One line per service: the hint of the selected one goes under the list.
        formatCheckResults(
          results.map(({ hint: _, ...result }) => result),
          { ...terminal, columns: Math.max(1, columns - MARKER_WIDTH) },
        ).split("\n");
  const empty = filter
    ? `no service matches "${filter}"`
    : onServiceWrite
      ? "no service: press a to add one"
      : "no service";
  const focused = results[current];
  const panelWidth = Math.min(panel?.kind === "service" ? DETAIL_WIDTH : PANEL_WIDTH, columns);
  const panelRoom = Math.max(1, panelWidth - PANEL_FRAME_WIDTH);
  const detailed =
    panel?.kind === "service" ? latest.find(({ name }) => name === panel.name) : undefined;
  // Around the detail: summary, list, target, border, title, rule, the settings, the bar.
  // One more line stays free: ink clears the whole screen on each draw of a frame as tall as it.
  const settingRows = SERVICE_ROWS.length + (panel?.kind === "service" ? variableRows.length : 0);
  const taken = 1 + Math.max(1, rows.length) + 1 + 2 + 1 + 1 + settingRows + 1 + 1;
  const detail = detailed
    ? detailLines(asShown(detailed), history[detailed.name] ?? [], {
        unicode,
        width: panelRoom,
        room: (windowRows || DEFAULT_ROWS) - taken - (unsaved === undefined ? 0 : 1),
      })
    : [];
  const toned = ({ text, tone }: (typeof detail)[number]) =>
    tone === "good"
      ? colors.green(text)
      : tone === "bad"
        ? colors.red(text)
        : tone === "dim"
          ? colors.dim(text)
          : text;
  const panelRows: [label: string, value: string][] =
    panel?.kind === "options"
      ? [
          ...SETTING_ROWS.map((row): [string, string] => [row.label, seconds(settings[row.key])]),
          ["Notify", settings.notify ? "on" : "off"],
        ]
      : panel
        ? [
            ["Skip", skipped.has(panel.name) ? "yes" : "no"],
            [
              "Timeout",
              timeouts[panel.name] === undefined ? "default" : `${timeouts[panel.name]}s`,
            ],
          ]
        : [];
  const shownVariables = panel?.kind === "service" ? variableRows : NO_VARIABLES;
  const labelWidth = Math.max(
    0,
    ...panelRows.map(([label]) => label.length),
    ...shownVariables.map(({ name }) => name.length),
  );
  const bullet = unicode ? "•" : "*";
  const screen: Screen =
    dialog?.kind === "form"
      ? "form"
      : dialog?.kind === "secret" || dialog?.kind === "variable"
        ? "input"
        : dialog
          ? "confirm"
          : palette
            ? "palette"
            : filtering
              ? "filter"
              : panel
                ? "panel"
                : "list";
  const hint = helpBar(screen, unicode, columns);
  const commands = palette ? paletteEntries(unicode, palette.query) : [];
  const commandWidth = Math.max(0, ...commands.map(({ label }) => label.length));
  const paletteRoom = Math.max(
    1,
    (windowRows || DEFAULT_ROWS) -
      (1 + Math.max(1, rows.length) + (focused ? 1 : 0) + (focused?.hint ? 1 : 0) + 1 + 1 + 1) -
      (unsaved === undefined ? 0 : 1),
  );
  const firstCommand = Math.max(0, (palette?.row ?? 0) - paletteRoom + 1);
  const formWidth = Math.min(FORM_WIDTH, columns);
  const formLabels = dialog?.kind === "form" ? formRows(dialog.editing === undefined) : [];
  const formLabelWidth = Math.max(
    HEADER_LABEL.length,
    ...formLabels.map(({ label }) => label.length),
  );
  const formRoom = Math.max(1, formWidth - PANEL_FRAME_WIDTH);
  const formLine = (active: boolean, label: string, value: string, placeholder: string) => {
    const prefix = `${active ? marker : "  "}${label.padEnd(formLabelWidth)}  `;
    const typed = active
      ? `${prefix}${ending(value, Math.max(1, formRoom - prefix.length - CURSOR.length))}${CURSOR}`
      : truncate(`${prefix}${value}`, formRoom);
    const example = value ? "" : truncate(placeholder, Math.max(0, formRoom - typed.length - 1));
    return (
      <>
        {typed}
        {example && colors.dim(`${active ? " " : ""}${example}`)}
      </>
    );
  };

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
      {focused?.hint && panel?.kind !== "service" && <Text>{colors.dim(cut(focused.hint))}</Text>}
      {panel !== null && (
        <Box
          flexDirection="column"
          width={panelWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>
            {colors.bold(truncate(panel.kind === "options" ? "Options" : panel.name, panelRoom))}
          </Text>
          {detail.map((line) => (
            <Text key={line.id}>{toned(line)}</Text>
          ))}
          {detail.length > 0 && <Text>{colors.dim((unicode ? "─" : "-").repeat(panelRoom))}</Text>}
          {panelRows.map(([label, value], index) => {
            const line = `${index === panel.row ? marker : "  "}${label.padEnd(labelWidth)}  ${
              unicode ? `‹ ${value} ›` : `< ${value} >`
            }`;
            return <Text key={label}>{truncate(line, panelRoom)}</Text>;
          })}
          {shownVariables.map(({ name, source }, index) => {
            const active = index + SERVICE_ROWS.length === panel.row;
            const enter = unicode ? "↵" : "enter";
            const state = source ? SOURCES[source] : "not set";
            const offer =
              active && onVariableWrite && source !== "environment"
                ? ` ${dot} ${enter} ${source ? "changes" : "sets"} it`
                : "";
            const line = `${active ? marker : "  "}${name.padEnd(labelWidth)}  ${state}${offer}`;
            return <Text key={`variable ${name}`}>{truncate(line, panelRoom)}</Text>;
          })}
        </Box>
      )}
      {filtering && <Text>{cut(`Filter: ${filter}${CURSOR}`)}</Text>}
      {palette && <Text>{cut(`: ${palette.query}${CURSOR}`)}</Text>}
      {palette &&
        commands
          .slice(firstCommand, firstCommand + paletteRoom)
          .map(({ command, label, keys }) => (
            <Text key={command}>
              {cut(
                `${commands[palette.row]?.command === command ? marker : "  "}${label.padEnd(commandWidth)}  ${keys}`,
              )}
            </Text>
          ))}
      {palette && commands.length === 0 && (
        <Text>{colors.dim(cut(`no command matches "${palette.query}"`))}</Text>
      )}
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
          {formLabels.map(({ key, label, placeholder }, index) => (
            <Text key={key}>
              {formLine(index === dialog.row, label, dialog.values[key], placeholder)}
            </Text>
          ))}
          {[...dialog.values.headers, ""].map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a header row is its position, its text changes at each key
            <Text key={`header ${index}`}>
              {formLine(
                formLabels.length + index === dialog.row,
                HEADER_LABEL,
                // Hidden before it is cut: no part of a secret is drawn.
                hiddenHeaderLine(line, bullet),
                HEADER_PLACEHOLDER,
              )}
            </Text>
          ))}
          {dialog.row >= formLabels.length && dialog.problem === undefined && (
            <Text>{colors.dim(truncate("Name: value. Emptied, it is removed.", formRoom))}</Text>
          )}
          {dialog.problem !== undefined && <Text>{colors.yellow(dialog.problem)}</Text>}
        </Box>
      )}
      {dialog?.kind === "secret" && (
        <Box
          flexDirection="column"
          width={formWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>{colors.bold(truncate(`${dialog.header} holds a secret`, formRoom))}</Text>
          <Text>{colors.dim(`${CONFIG_FILE} gets a reference, ${LOCAL} the value.`)}</Text>
          <Text>
            {dialog.variable === undefined
              ? colors.dim("looking for a name…")
              : `${marker}Variable  ${ending(
                  dialog.variable,
                  Math.max(1, formRoom - marker.length - "Variable  ".length - CURSOR.length),
                )}${CURSOR}`}
          </Text>
          {dialog.variable !== undefined && dialog.problem === undefined && (
            <Text>
              {colors.dim(
                truncate(
                  hiddenHeaderLine(
                    withVariable(dialog.form.values, dialog, dialog.variable).headers[
                      dialog.index
                    ] ?? "",
                    bullet,
                  ),
                  formRoom,
                ),
              )}
            </Text>
          )}
          {dialog.problem !== undefined && <Text>{colors.yellow(dialog.problem)}</Text>}
        </Box>
      )}
      {dialog?.kind === "variable" && (
        <>
          <Text>
            {cut(`Value of ${dialog.name}: ${bullet.repeat(dialog.value.length)}${CURSOR}`)}
          </Text>
          <Text>
            {dialog.problem === undefined
              ? colors.dim(cut(`not shown, kept in ${LOCAL} on this machine only`))
              : colors.yellow(cut(dialog.problem))}
          </Text>
        </>
      )}
      {/* Not cut: a command that could not be copied must be readable whole. */}
      {notice !== undefined && <Text>{notice}</Text>}
      {unsaved !== undefined && <Text>{colors.yellow(cut(`not saved: ${unsaved}`))}</Text>}
      <Text>{colors.dim(cut(hint))}</Text>
    </Box>
  );
}
