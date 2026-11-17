import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "../checkers/types";
import type { ParameterProblem, ParameterWrite } from "../commands/parameter-writes";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import { hiddenHeaderLine, serviceVariables, variableValueProblem } from "../config/headers";
import {
  effectiveSelection,
  mergedChoices,
  type ParameterChoices,
  type Selection,
} from "../config/parameters";
import { type Parameter, urlProblem } from "../config/schema";
import {
  CONFIG_FILE,
  LOCAL_ENVIRONMENT,
  LOCAL_FILE,
  NOTIFY_GRACE_SECONDS,
  PROBE_DIR,
} from "../constants";
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
import { formatGrid, type GridColumn, rowNames, upCount } from "./grid";
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
import {
  type Addresses,
  type AddressRow,
  addressChanges,
  addressOf,
  addressRows,
  EMPTY_PARAMETER_FORM,
  formParameter,
  KIND_HINT,
  nextKind,
  type ParameterFormValues,
  parameterExample,
  parameterFormProblem,
  parameterFormRow,
  parameterFormRows,
  parameterFormValues,
  withAddress,
  withScheme,
} from "./parameter-form";
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
    selection: Selection,
  ) => Promise<CheckResult[]>;
  /** The parameters of the local config and their values. */
  parameters?: () => ParameterChoices;
  /** The values chosen last time: one choice for every column. */
  selection?: Selection;
  onParameterChange?: (name: string, value: string) => Saved | undefined;
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
  onOpen?: (name: string, selection?: Selection) => Promise<string>;
  onCopy?: (name: string, timeout: number | undefined, selection?: Selection) => Promise<string>;
  onNotify?: (message: string) => Promise<string | undefined>;
  graceMs?: number;
  now?: () => number;
  /** Whether the terminal has the focus, when it says so: nothing is notified to someone looking at it. */
  terminalFocused?: () => boolean | undefined;
  onClose?: () => void;
  serviceFields?: (name: string) => ServiceFields | string | undefined;
  onServiceWrite?: (write: ServiceWrite, secrets?: Secrets) => Promise<ServiceWriteOutcome>;
  /** A parameter of the local config, to edit; undefined when only another environment declares it. */
  parameterFields?: (name: string) => Parameter | undefined;
  onParameterWrite?: (write: ParameterWrite) => Promise<ParameterWriteOutcome>;
  /** The services of the local config and their address for each value of the `url` parameter. */
  addresses?: () => Addresses;
  variables?: VariableTools;
  onVariableWrite?: (name: string, value: string) => Saved;
  environments?: readonly EnvironmentColumn[];
}

export interface EnvironmentColumn {
  name: string;
  file: string;
  check: (signal: AbortSignal, timeoutMs: number, selection?: Selection) => Promise<CheckResult[]>;
  onOpen?: (name: string, selection?: Selection) => Promise<string>;
  onCopy?: (name: string, selection?: Selection) => Promise<string>;
  /** Its file is read again at each pass: so are its parameters. */
  parameters?: () => ParameterChoices;
}

interface RemoteState {
  results?: CheckResult[];
  problem?: string;
  history: LatencyHistory;
}

export type Secrets = Readonly<Record<string, string>>;

export interface ServiceWriteOutcome {
  saved: boolean;
  failure?: string;
  warning?: string;
}

export interface ParameterWriteOutcome {
  saved: boolean;
  problem?: ParameterProblem;
  failure?: string;
  drops?: string[];
}

export type ServiceTimeouts = Readonly<Record<string, number | undefined>>;

type Panel =
  | { kind: "options"; row: number }
  | { kind: "parameters"; row: number }
  | { kind: "service"; name: string; environment?: string; row: number };

interface Form {
  kind: "form";
  editing?: string;
  row: number;
  values: FormValues;
  problem?: string;
  secrets?: Secrets;
}

type SecretStep = FormSecret & { kind: "secret"; form: Form; variable?: string; problem?: string };

interface ParameterForm {
  kind: "parameter-form";
  editing?: string;
  row: number;
  values: ParameterFormValues;
  /** Kept while the way of sending or the values change: going back to `url` gives them again. */
  addresses: Addresses;
  initial: Addresses;
  problem?: string;
}

type Dialog =
  | { kind: "confirm"; name: string }
  | { kind: "parameter-confirm"; name: string }
  | { kind: "address-drops"; form: ParameterForm; drops: string[] }
  | ParameterForm
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
const NO_ENVIRONMENTS: readonly EnvironmentColumn[] = [];
const NO_SELECTION: Selection = {};
const NO_CHOICES: ParameterChoices = {};
const CLOSING_KEYS = { options: "o", parameters: "p" };
const NEVER_SEEN: KnownStates = new Map();
const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;
const SOURCES = { environment: "set in the environment", local: `set in ${LOCAL_FILE}` };

const MARKER_WIDTH = 2;
const PANEL_WIDTH = 30;
const TAB_GAP = " ";

/** The parts joined by `gap`, starting late enough for the part at `focus` to fit in `width`. */
function scrolled(parts: readonly string[], focus: number, width: number, gap: string): string {
  const from = (first: number, last = focus) =>
    `${first > 0 ? "… " : ""}${parts.slice(first, last + 1).join(gap)}`;
  let first = 0;
  while (first < focus && from(first).length > width) first += 1;
  return from(first, parts.length - 1);
}
const DETAIL_WIDTH = 60;
// What the screen keeps around the detail when a terminal does not tell its height.
const DEFAULT_ROWS = 24;
const FORM_WIDTH = 48;
// The dashboard lines, the frame and the fields of the form around the address lines.
const ADDRESS_ROOM_TAKEN = 14;
const ADDRESS_ROOM_MIN = 3;
const CURSOR = "_";
const PANEL_FRAME_WIDTH = 4;

const seconds = (ms: number) => `${ms / 1000}s`;

function pause(ms: number, signal: AbortSignal, keep: (skip: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const skip = () => {
      clearTimeout(timer);
      resolve();
    };
    keep(skip);
    signal.addEventListener("abort", skip, { once: true });
  });
}

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
  graceMs = NOTIFY_GRACE_SECONDS * 1000,
  now = Date.now,
  terminalFocused,
  onClose,
  serviceFields,
  onServiceWrite,
  parameterFields,
  addresses,
  onParameterWrite,
  variables,
  onVariableWrite,
  environments = NO_ENVIRONMENTS,
  parameters,
  selection: savedSelection = NO_SELECTION,
  onParameterChange,
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
  const [column, setColumn] = useState(0);
  const [remote, setRemote] = useState<Readonly<Record<string, RemoteState>>>({});
  // One choice for every column: a column that does not list a value keeps its first one.
  const [selection, setSelection] = useState(savedSelection);
  const grid = environments.length > 0;
  const looking = useRef(false);
  const skipPause = useRef(() => {});
  const skipRemotePauses = useRef<(() => void)[]>([]);
  // A change stays in effect for this run even when saving it failed: the failure is shown instead.
  const track = (saved: Saved | undefined) => {
    void saved?.then(setUnsaved);
  };
  const { intervalMs, timeoutMs } = settings;
  // Kept across passes and settings: a change is told once, and turning the notifications on tells nothing old.
  const known = useRef<KnownStates>(new Map());
  const remoteKnown = useRef(new Map<string, KnownStates>());
  const notifying = useRef(false);
  notifying.current = settings.notify === true;
  const warned = useRef(false);
  const tell = (next: CheckResult[], environment?: string) => {
    const before =
      environment === undefined
        ? known.current
        : (remoteKnown.current.get(environment) ?? NEVER_SEEN);
    const { known: after, changes } = stateChanges(before, next, now(), graceMs);
    if (environment === undefined) known.current = after;
    else remoteKnown.current.set(environment, after);
    if (!notifying.current || changes.length === 0 || terminalFocused?.() === true) return;
    const scope = grid ? `${environment ?? LOCAL_ENVIRONMENT}/` : "";
    const named = changes.map((change) => ({ ...change, name: `${scope}${change.name}` }));
    // Not awaited: the checks go on whatever the desktop does.
    void onNotify?.(changeMessage(named)).then((warning) => {
      if (warning === undefined || warned.current) return;
      warned.current = true;
      setNotice(warning);
    });
  };

  useEffect(() => onClose, [onClose]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a write to the config starts a new pass
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loop = async () => {
      while (!signal.aborted) {
        const next = await check(signal, timeoutMs, skipped, timeouts, selection);
        if (signal.aborted) return;
        setLatest(next);
        tell(next);
        setHistory((before) => recordLatencies(before, next));
        await pause(intervalMs, signal, (skip) => {
          skipPause.current = skip;
        });
      }
    };
    void loop();
    return () => controller.abort();
  }, [check, intervalMs, timeoutMs, skipped, timeouts, writes, selection]);

  // Apart from the local loop: a skip or a write there does not cut the requests in flight here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tell` reads refs only
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    environments.forEach(({ name, check: checkRemote }, index) => {
      const loop = async () => {
        while (!signal.aborted) {
          // A file that cannot be read now is read again at the next pass.
          const outcome = await checkRemote(signal, timeoutMs, selection).catch((error: unknown) =>
            error instanceof Error ? error.message : String(error),
          );
          if (signal.aborted) return;
          setRemote((before) => {
            const history = before[name]?.history ?? {};
            const state: RemoteState =
              typeof outcome === "string"
                ? { problem: outcome, history }
                : { results: outcome, history: recordLatencies(history, outcome) };
            return { ...before, [name]: state };
          });
          if (typeof outcome !== "string") tell(outcome, name);
          await pause(intervalMs, signal, (skip) => {
            skipRemotePauses.current[index] = skip;
          });
        }
      };
      void loop();
    });
    return () => controller.abort();
  }, [environments, intervalMs, timeoutMs, selection]);

  const detailedName =
    panel?.kind === "service" && panel.environment === undefined ? panel.name : undefined;
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

  // A service just set aside is shown as such at once, not when the pass that skips it ends.
  const asShown = (result: CheckResult): CheckResult => {
    if (result.skipped || !skipped.has(result.name)) return result;
    const { name, type, target } = result;
    return { name, type, target, ok: true, skipped: true, latencyMs: 0 };
  };
  const wanted = filter.toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(wanted);
  const shown = (latest ?? []).filter(({ name }) => matches(name));
  const gridColumns: GridColumn[] = [
    { name: LOCAL_ENVIRONMENT, results: latest?.map(asShown) },
    ...environments.map(({ name }) => ({
      name,
      results: remote[name]?.results,
      problem: remote[name]?.problem,
    })),
  ];
  const names = grid ? rowNames(gridColumns).filter(matches) : shown.map(({ name }) => name);
  const last = Math.max(0, names.length - 1);
  const current = Math.min(selected, last);
  const environment = column > 0 ? environments[column - 1] : undefined;
  const selectedName = names[current];
  const cell = (environment ? remote[environment.name]?.results : latest)?.find(
    ({ name }) => name === selectedName,
  );
  const place = environment?.name ?? LOCAL_ENVIRONMENT;
  const allChoices = () =>
    mergedChoices([
      parameters?.() ?? NO_CHOICES,
      ...environments.map((each) => each.parameters?.() ?? NO_CHOICES),
    ]);
  const choices = allChoices();
  const choiceNames = Object.keys(choices);
  const effective = effectiveSelection(choices, selection);
  const own = effectiveSelection(
    (environment ? environment.parameters?.() : parameters?.()) ?? NO_CHOICES,
    selection,
  );

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

  const changeParameter = (rowIndex: number, direction: 1 | -1) => {
    const name = choiceNames[rowIndex];
    const values = name === undefined ? undefined : choices[name];
    if (name === undefined || !values) return;
    const at = values.indexOf(effective[name] as string) + direction;
    const value = values[Math.max(0, Math.min(values.length - 1, at))];
    if (value === undefined || value === effective[name]) return;
    setSelection({ ...selection, [name]: value });
    track(onParameterChange?.(name, value));
    restart();
  };

  // Another value is another target: the latencies and the states start again.
  const restart = () => {
    known.current = new Map();
    remoteKnown.current.clear();
    setHistory({});
    setRemote((before) =>
      Object.fromEntries(
        Object.entries(before).map(([each, state]) => [each, { ...state, history: {} }]),
      ),
    );
  };

  const parameterWritten = (name: string, done: string) => {
    setNotice(done);
    restart();
    setWrites((count) => count + 1);
    const names = Object.keys(allChoices());
    const at = names.indexOf(name);
    setPanel({
      kind: "parameters",
      row: Math.max(0, at >= 0 ? at : Math.min(panel?.row ?? 0, names.length - 1)),
    });
  };

  const services = () => Object.keys(addresses?.() ?? {});

  const submitParameter = (form: ParameterForm, confirmed = false) => {
    const rows = parameterFormRows(form.editing === undefined, form.values.strategy);
    const lines = addressRows(form.values, services());
    const taken = Object.keys(parameters?.() ?? NO_CHOICES);
    const problem = parameterFormProblem(rows, form.values, taken);
    if (problem) return setDialog({ ...form, row: problem.row, problem: problem.message });
    const wrong = lines.findIndex((line) => {
      const address = withScheme(addressOf(form.addresses, line));
      return address !== "" && urlProblem(address) !== undefined;
    });
    if (wrong >= 0) {
      const line = lines[wrong] as AddressRow;
      const message = `${line.service} ${line.value}: expects ${urlProblem(withScheme(addressOf(form.addresses, line)))}`;
      return setDialog({ ...form, row: rows.length + wrong, problem: message });
    }
    const name = form.editing ?? form.values.name;
    const parameter = formParameter(form.values, name);
    const change = {
      name,
      parameter,
      ...(confirmed ? { confirmed } : {}),
      ...(parameter.strategy.kind === "url"
        ? { addresses: addressChanges(lines, form.addresses, form.initial) }
        : {}),
    };
    looking.current = true;
    void onParameterWrite?.(
      form.editing === undefined ? { kind: "add", ...change } : { kind: "edit", ...change },
    ).then((outcome) => {
      looking.current = false;
      if (outcome.drops) return setDialog({ kind: "address-drops", form, drops: outcome.drops });
      if (outcome.problem) {
        const { field, address } = outcome.problem;
        const at = lines.findIndex(
          ({ service, value }) => service === address?.service && value === address?.value,
        );
        const row =
          field === "address" && at >= 0
            ? rows.length + at
            : parameterFormRow(rows, field === "address" ? "values" : field);
        return setDialog({ ...form, row, problem: outcome.problem.message });
      }
      setDialog(null);
      setUnsaved(outcome.failure);
      if (outcome.saved) parameterWritten(name, `${form.editing ? "Saved" : "Added"} ${name}`);
    });
  };

  const typeInParameterForm = (form: ParameterForm, keystroke: Keystroke) => {
    if (looking.current) return;
    const { key } = keystroke;
    const rows = parameterFormRows(form.editing === undefined, form.values.strategy);
    const lines = addressRows(form.values, services());
    const field = rows[form.row]?.key;
    const line = lines[form.row - rows.length];
    const typed = typedCharacter(keystroke);
    const value = field ? form.values[field] : line ? addressOf(form.addresses, line) : "";
    const edit = (next: string) => {
      if (field) {
        const values = { ...form.values, [field]: next };
        // Fewer lines once a value goes: the selected row stays on the form.
        const count = rows.length + addressRows(values, services()).length;
        const changedRows = parameterFormRows(form.editing === undefined, values.strategy).length;
        const row = Math.min(form.row, Math.max(changedRows, count) - 1);
        setDialog({ ...form, values, row, problem: undefined });
      } else if (line)
        setDialog({
          ...form,
          addresses: withAddress(form.addresses, line, next),
          problem: undefined,
        });
    };
    const total = rows.length + lines.length;
    const lastRow = total - 1;
    // The way of sending is chosen, not typed: four words, and a typo would only be refused.
    const choosing = field === "strategy";
    if (choosing && (key === "left" || key === "right" || typed))
      edit(nextKind(value, typed ?? (key === "right" ? 1 : -1)));
    else if (key === "escape") setDialog(null);
    else if (key === "up") setDialog({ ...form, row: Math.max(0, form.row - 1) });
    else if (key === "down") setDialog({ ...form, row: Math.min(lastRow, form.row + 1) });
    else if (key === "tab") setDialog({ ...form, row: (form.row + 1) % total });
    else if (choosing && key !== "return") return;
    else if (key === "backspace") edit(value.slice(0, -1));
    else if (key === "clear") edit("");
    else if (typed) edit(value + typed);
    else if (key === "return") submitParameter(form);
  };

  const removeParameter = (name: string) => {
    looking.current = true;
    void onParameterWrite?.({ kind: "remove", name }).then((outcome) => {
      looking.current = false;
      setUnsaved(outcome.failure);
      if (outcome.problem) return setNotice(outcome.problem.message);
      if (outcome.saved) parameterWritten(name, `Removed ${name}`);
    });
  };

  // Only the parameters of config.yml are written here: one an environment declares says its file.
  const declaredElsewhere = (name: string) => {
    const files = environments
      .filter((each) => Object.hasOwn(each.parameters?.() ?? NO_CHOICES, name))
      .map(({ file }) => file);
    return `${name} is not in ${PROBE_DIR}/${CONFIG_FILE}: change it in ${files.join(", ")}`;
  };

  const editParameters = (input: string, name: string | undefined) => {
    if (!onParameterWrite) return;
    const known = addresses?.() ?? {};
    if (input === "a")
      return setDialog({
        kind: "parameter-form",
        row: 0,
        values: EMPTY_PARAMETER_FORM,
        addresses: known,
        initial: known,
      });
    if (name === undefined) return;
    const parameter = parameterFields?.(name);
    if (!parameter) return setNotice(declaredElsewhere(name));
    if (input === "e")
      setDialog({
        kind: "parameter-form",
        editing: name,
        row: 0,
        values: parameterFormValues(parameter),
        addresses: known,
        initial: known,
      });
    else setDialog({ kind: "parameter-confirm", name });
  };

  const changeTimeout = (name: string, direction: 1 | -1) => {
    const value = stepServiceTimeout(timeouts[name], direction);
    if (value === timeouts[name]) return;
    setTimeouts({ ...timeouts, [name]: value });
    track(onTimeoutChange?.(name, value));
  };

  const run = (command: Command) => {
    // The name of a cell that holds a service: an empty one gives nothing to act on.
    const name = cell?.name;
    // Every write below goes to the local files: none is offered from another environment.
    const elsewhere =
      environment && `${environment.name} is not edited here: change ${environment.file}`;
    switch (command) {
      case "check":
        skipPause.current();
        for (const skip of skipRemotePauses.current) skip();
        return;
      case "options":
        return setPanel({ kind: "options", row: 0 });
      case "parameters":
        // With nothing declared, the panel opens to add the first one.
        if (choiceNames.length > 0 || onParameterWrite)
          return setPanel({ kind: "parameters", row: 0 });
        return setNotice(
          grid ? "No parameter declared" : `${PROBE_DIR}/${CONFIG_FILE} declares no parameter`,
        );
      case "detail":
        return name
          ? setPanel({ kind: "service", name, environment: environment?.name, row: 0 })
          : undefined;
      case "open":
        if (!name) return;
        return void (
          environment ? environment.onOpen?.(name, selection) : onOpen?.(name, selection)
        )?.then(setNotice);
      case "copy":
        if (!name) return;
        return void (
          environment
            ? environment.onCopy?.(name, selection)
            : onCopy?.(name, timeouts[name], selection)
        )?.then(setNotice);
      case "filter":
        return setFiltering(true);
      case "add":
        if (elsewhere) return setNotice(elsewhere);
        return onServiceWrite ? setDialog({ kind: "form", row: 0, values: EMPTY_FORM }) : undefined;
      case "edit": {
        if (elsewhere) return setNotice(elsewhere);
        const fields = onServiceWrite && name ? serviceFields?.(name) : undefined;
        if (typeof fields === "string") return setNotice(fields);
        if (fields) setDialog({ kind: "form", editing: name, row: 0, values: formValues(fields) });
        return;
      }
      case "remove":
        if (elsewhere) return setNotice(elsewhere);
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
    else if (dialog?.kind === "parameter-form") typeInParameterForm(dialog, keystroke);
    else if (dialog?.kind === "address-drops") {
      if (input === "y") submitParameter(dialog.form, true);
      else if (input === "n" || keystroke.key === "escape") setDialog(dialog.form);
    } else if (dialog?.kind === "parameter-confirm") {
      setDialog(null);
      if (input === "y") removeParameter(dialog.name);
    } else if (dialog?.kind === "secret") typeSecret(dialog, keystroke);
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
      else if (grid && (left || right))
        setColumn(Math.max(0, Math.min(environments.length, column + (right ? 1 : -1))));
    } else if (enter && variableRow) askVariable(variableRow);
    else if (
      key === "escape" ||
      (panel.kind === "service" ? enter : input === CLOSING_KEYS[panel.kind])
    )
      setPanel(null);
    else if (panel.kind === "parameters") {
      if (left || right) {
        const row = Math.max(0, Math.min(choiceNames.length - 1, panel.row + (right ? 1 : -1)));
        setPanel({ ...panel, row });
      } else if (up || down) changeParameter(panel.row, down ? 1 : -1);
      else if (input === "a" || input === "e" || input === "d")
        editParameters(input, choiceNames[panel.row]);
    } else if (panel.kind === "service" && panel.environment !== undefined) {
      // The rows of this panel write for the local services: for another environment, `probe var --env` or local.yml by hand.
    } else if (up || down) {
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
  const more = unicode ? "…" : "...";
  const cut = (text: string) => truncate(text, Math.max(1, columns));

  // A line per service and value: only the lines around the selected one fit the window.
  const addressSection = (form: ParameterForm) => {
    const rows = parameterFormRows(form.editing === undefined, form.values.strategy);
    const lines = addressRows(form.values, services());
    if (lines.length === 0) return null;
    const room = Math.max(
      ADDRESS_ROOM_MIN,
      (windowRows || DEFAULT_ROWS) - ADDRESS_ROOM_TAKEN - rows.length,
    );
    const selected = form.row - rows.length;
    const first = Math.max(0, Math.min(selected - room + 1, lines.length - room));
    const shown = lines.slice(Math.max(0, first), Math.max(0, first) + room);
    const serviceWidth = Math.max(...lines.map(({ service }) => service.length));
    const valueWidth = Math.max(...lines.map(({ value }) => value.length));
    const width = serviceWidth + 1 + valueWidth;
    const above = Math.max(0, first);
    const below = lines.length - above - shown.length;
    return (
      <>
        <Text>{truncate("Addresses (empty: the service address)", formRoom)}</Text>
        {above > 0 && <Text>{colors.dim(`  ${more} ${above} above`)}</Text>}
        {shown.map((line, index) => {
          const at = above + index;
          const repeated = at > 0 && lines[at - 1]?.service === line.service;
          const label = `${(repeated ? "" : line.service).padEnd(serviceWidth)} ${line.value.padEnd(valueWidth)}`;
          return (
            <Text key={`${line.service} ${line.value}`}>
              {formLine(
                form.row === rows.length + at,
                label,
                addressOf(form.addresses, line),
                "",
                width,
              )}
            </Text>
          );
        })}
        {below > 0 && <Text>{colors.dim(`  ${more} ${below} more`)}</Text>}
      </>
    );
  };

  if (help) {
    const [left = [], right = []] = helpColumns(unicode, columns, grid);
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

  const results = shown.map(asShown);

  const all = latest.filter((result) => !result.skipped && !skipped.has(result.name));
  const aside = latest.length - all.length;
  const counts = environments.map(({ name }) => upCount(remote[name]?.results ?? []));
  const up = counts.reduce((sum, count) => sum + count.up, all.filter(({ ok }) => ok).length);
  const checked = counts.reduce((sum, count) => sum + count.checked, all.length);
  const choosing = panel?.kind === "parameters" ? panel.row : -1;
  // Without color, the marker shows which one is being changed: with color, it is drawn in reverse.
  const pointer = terminal.color ? "" : marker;
  const selectorParts = choiceNames.map((name, index) => {
    const value = effective[name] ?? "";
    const shown = `${name} ${unicode ? `‹ ${value} ›` : `< ${value} >`}`;
    return index === choosing ? `${pointer}${shown}` : shown;
  });
  const selectors = scrolled(selectorParts, Math.max(0, choosing), columns, "   ");
  // Said apart: the selected column does not list the value chosen, it keeps its first one.
  const kept = Object.entries(own)
    .filter(([name, value]) => effective[name] !== value)
    .map(([name, value]) => `${name}=${value}`);
  const keptNote = kept.length > 0 ? `${place} uses ${kept.join(" ")}` : "";
  const selectorLines = choiceNames.length > 0 ? 1 : 0;
  const selectorLine = cut(keptNote ? `${selectors} ${dot} ${keptNote}` : selectors);
  const table = grid
    ? formatGrid(
        names,
        gridColumns,
        { row: current, column },
        { width: Math.max(1, columns), unicode, colors },
      )
    : undefined;
  const summary = [
    "probe",
    `${up}/${checked} up`,
    ...(aside > 0 ? [`${aside} skipped`] : []),
    `every ${seconds(intervalMs)}`,
    ...(table && table.hidden > 0
      ? [`${gridColumns[column]?.name} ${column + 1}/${gridColumns.length}`]
      : []),
    ...(filter && !filtering ? [`filter: ${filter}`] : []),
  ].join(` ${dot} `);
  const rows = table
    ? table.rows
    : results.length === 0
      ? []
      : // One line per service: the hint of the selected one goes under the list.
        formatCheckResults(
          results.map(({ hint: _, ...result }) => result),
          // No link here: ink measures and cuts these lines itself.
          { ...terminal, hyperlinks: false, columns: Math.max(1, columns - MARKER_WIDTH) },
        ).split("\n");
  const empty = filter
    ? `no service matches "${filter}"`
    : onServiceWrite
      ? "no service: press a to add one"
      : "no service";
  const focused = cell && (environment ? cell : asShown(cell));
  const placed = grid ? `${place} ${dot} ` : "";
  const problem = environment && remote[environment.name]?.problem;
  const answered = environment ? remote[environment.name]?.results !== undefined : true;
  const absent =
    grid && selectedName !== undefined && !focused && answered
      ? `${selectedName} is not in ${environment?.file ?? `${PROBE_DIR}/${CONFIG_FILE}`}`
      : undefined;
  const panelWidth = Math.min(panel?.kind === "service" ? DETAIL_WIDTH : PANEL_WIDTH, columns);
  const panelRoom = Math.max(1, panelWidth - PANEL_FRAME_WIDTH);
  // Reverse video on the part being changed; without color, the marker already shows it.
  const highlighted = (text: string, part: string | undefined) => {
    const at = part && terminal.color ? text.indexOf(part) : -1;
    if (!part || at < 0) return text;
    return `${text.slice(0, at)}${colors.inverse(part)}${text.slice(at + part.length)}`;
  };
  const choosingName = choiceNames[Math.max(0, choosing)] ?? "";
  const tabParts = choiceNames.map((name, index) =>
    index !== choosing ? ` ${name} ` : terminal.color ? ` ${name} ` : `[${name}]`,
  );
  const choiceValues = choices[choosingName] ?? [];
  const choiceWidth = Math.min(
    Math.max(PANEL_WIDTH, tabParts.join(TAB_GAP).length + PANEL_FRAME_WIDTH),
    columns,
  );
  const choiceRoom = Math.max(1, choiceWidth - PANEL_FRAME_WIDTH);
  const tabs = truncate(scrolled(tabParts, Math.max(0, choosing), choiceRoom, TAB_GAP), choiceRoom);
  const chosenValue = effective[choosingName];
  // Around the values: summary, selectors, list, target, border, title, tabs, the bar, one free line.
  const valueRoom = Math.max(
    1,
    (windowRows || DEFAULT_ROWS) -
      (1 + selectorLines + Math.max(1, (grid ? 1 : 0) + names.length) + 1 + 2 + 1 + 1 + 1 + 1),
  );
  const firstValue = Math.max(
    0,
    Math.min(
      choiceValues.indexOf(chosenValue ?? "") - Math.floor(valueRoom / 2),
      choiceValues.length - valueRoom,
    ),
  );
  const shownValues = choiceValues.slice(firstValue, firstValue + valueRoom);
  const detailedIn = panel?.kind === "service" ? panel.environment : undefined;
  const detailed =
    panel?.kind === "service"
      ? (detailedIn === undefined ? latest : remote[detailedIn]?.results)?.find(
          ({ name }) => name === panel.name,
        )
      : undefined;
  const detailedHistory = detailedIn === undefined ? history : (remote[detailedIn]?.history ?? {});
  // Around the detail: summary, list, target, border, title, rule, the settings, the bar.
  // One more line stays free: ink clears the whole screen on each draw of a frame as tall as it.
  const settingRows = SERVICE_ROWS.length + (panel?.kind === "service" ? variableRows.length : 0);
  const listLines = Math.max(1, rows.length) + (grid ? 1 : 0);
  const taken = 1 + selectorLines + listLines + 1 + 2 + 1 + 1 + settingRows + 1 + 1;
  const detail = detailed
    ? detailLines(
        detailedIn === undefined ? asShown(detailed) : detailed,
        detailedHistory[detailed.name] ?? [],
        {
          unicode,
          width: panelRoom,
          room: (windowRows || DEFAULT_ROWS) - taken - (unsaved === undefined ? 0 : 1),
        },
      )
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
      : panel?.kind === "service" && panel.environment === undefined
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
    dialog?.kind === "form" || dialog?.kind === "parameter-form"
      ? "form"
      : dialog?.kind === "secret" || dialog?.kind === "variable"
        ? "input"
        : dialog
          ? "confirm"
          : palette
            ? "palette"
            : filtering
              ? "filter"
              : panel?.kind === "parameters"
                ? "choose"
                : panel
                  ? panel.kind === "service" && panel.environment
                    ? "readonly"
                    : "panel"
                  : "list";
  const hint = helpBar(screen, unicode, columns, grid, choiceNames.length > 0);
  const commands = palette ? paletteEntries(unicode, palette.query) : [];
  const commandWidth = Math.max(0, ...commands.map(({ label }) => label.length));
  const paletteRoom = Math.max(
    1,
    (windowRows || DEFAULT_ROWS) -
      (1 + selectorLines + listLines + (focused ? 1 : 0) + (focused?.hint ? 1 : 0) + 1 + 1 + 1) -
      (unsaved === undefined ? 0 : 1),
  );
  const firstCommand = Math.max(0, (palette?.row ?? 0) - paletteRoom + 1);
  const formWidth = Math.min(FORM_WIDTH, columns);
  const formLabels =
    dialog?.kind === "form"
      ? formRows(dialog.editing === undefined)
      : dialog?.kind === "parameter-form"
        ? parameterFormRows(dialog.editing === undefined, dialog.values.strategy)
        : [];
  const formLabelWidth = Math.max(
    HEADER_LABEL.length,
    ...formLabels.map(({ label }) => label.length),
  );
  const formRoom = Math.max(1, formWidth - PANEL_FRAME_WIDTH);
  const formLine = (
    active: boolean,
    label: string,
    value: string,
    placeholder: string,
    labelWidth = formLabelWidth,
  ) => {
    const prefix = `${active ? marker : "  "}${label.padEnd(labelWidth)}  `;
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
      {selectorLines > 0 && (
        <Text>
          {highlighted(selectorLine.slice(0, selectors.length), selectorParts[choosing])}
          {colors.dim(selectorLine.slice(selectors.length))}
        </Text>
      )}
      {table && <Text>{table.header}</Text>}
      {rows.map((row, index) => (
        <Text key={names[index]}>
          {!table && (index === current ? marker : "  ")}
          {row}
        </Text>
      ))}
      {rows.length === 0 && <Text>{colors.dim(cut(empty))}</Text>}
      {focused && (
        <Text>
          {colors.dim(
            cut(
              `${placed}${focused.error ? `${focused.target} ${dot} ${focused.error}` : focused.target}`,
            ),
          )}
        </Text>
      )}
      {absent !== undefined && problem === undefined && (
        <Text>{colors.dim(cut(`${placed}${absent}`))}</Text>
      )}
      {problem !== undefined && <Text>{colors.yellow(cut(`${placed}${problem}`))}</Text>}
      {focused?.hint && panel?.kind !== "service" && <Text>{colors.dim(cut(focused.hint))}</Text>}
      {panel?.kind === "parameters" && (
        <Box
          flexDirection="column"
          width={choiceWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>{colors.bold("Parameters")}</Text>
          {choiceNames.length > 0 ? (
            <Text>{highlighted(tabs, tabParts[panel.row])}</Text>
          ) : (
            <Text>{colors.dim(truncate("None yet: a adds one", choiceRoom))}</Text>
          )}
          {shownValues.map((value) => (
            <Text key={value}>
              {value === chosenValue
                ? colors.inverse(truncate(`${marker}${value}`, choiceRoom).padEnd(choiceRoom))
                : truncate(`  ${value}`, choiceRoom)}
            </Text>
          ))}
        </Box>
      )}
      {panel !== null && panel.kind !== "parameters" && (
        <Box
          flexDirection="column"
          width={panelWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>
            {colors.bold(
              truncate(
                panel.kind === "options"
                  ? "Options"
                  : panel.environment === undefined
                    ? panel.name
                    : `${panel.name} ${dot} ${panel.environment}`,
                panelRoom,
              ),
            )}
          </Text>
          {detail.map((line) => (
            <Text key={line.id}>{toned(line)}</Text>
          ))}
          {detail.length > 0 && panelRows.length > 0 && (
            <Text>{colors.dim((unicode ? "─" : "-").repeat(panelRoom))}</Text>
          )}
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
      {dialog?.kind === "parameter-confirm" && (
        <Text>{colors.bold(cut(`Remove the parameter ${dialog.name} from the config?`))}</Text>
      )}
      {dialog?.kind === "address-drops" && (
        <>
          <Text>
            {colors.bold(
              cut(
                `Remove ${dialog.drops.length} ${dialog.drops.length === 1 ? "address" : "addresses"}: ${dialog.drops.join(", ")}?`,
              ),
            )}
          </Text>
          <Text>
            {colors.dim(cut("Their values are no longer listed. n goes back to the form."))}
          </Text>
        </>
      )}
      {dialog?.kind === "parameter-form" && (
        <Box
          flexDirection="column"
          width={formWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>
            {colors.bold(
              truncate(
                dialog.editing === undefined ? "Add a parameter" : `Edit ${dialog.editing}`,
                formRoom,
              ),
            )}
          </Text>
          {parameterFormRows(dialog.editing === undefined, dialog.values.strategy).map(
            ({ key, label, placeholder }, index) => (
              <Text key={key}>
                {key === "strategy"
                  ? truncate(
                      `${index === dialog.row ? marker : "  "}${label.padEnd(formLabelWidth)}  ${
                        unicode ? `‹ ${dialog.values[key]} ›` : `< ${dialog.values[key]} >`
                      }`,
                      formRoom,
                    )
                  : formLine(index === dialog.row, label, dialog.values[key], placeholder)}
              </Text>
            ),
          )}
          {addressSection(dialog)}
          {parameterExample(dialog.values, dialog.editing ?? dialog.values.name.trim()).map(
            (line) => (
              <Text key={line}>{colors.dim(truncate(line, formRoom))}</Text>
            ),
          )}
          {parameterFormRows(dialog.editing === undefined, dialog.values.strategy)[dialog.row]
            ?.key === "strategy" &&
            dialog.problem === undefined && (
              <Text>{colors.dim(truncate(KIND_HINT, formRoom))}</Text>
            )}
          {dialog.problem !== undefined && <Text>{colors.yellow(dialog.problem)}</Text>}
        </Box>
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
          {formRows(dialog.editing === undefined).map(({ key, label, placeholder }, index) => (
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
