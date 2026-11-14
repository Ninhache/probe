import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "../checkers/types";
import { createColors } from "../ui/colors";
import { formatCheckResults } from "../ui/report";
import { type Terminal, truncate } from "../ui/terminal";
import { type DashboardSettings, SETTING_ROWS, stepChoice } from "./settings";

export interface DashboardProps {
  terminal: Terminal;
  /** Settings the dashboard starts with; the options panel changes them while it runs. */
  settings: DashboardSettings;
  /** Services set aside when the dashboard opens; the service panel changes them while it runs. */
  skipped?: Iterable<string>;
  /**
   * Runs one pass of checks, leaving the `skipped` services unchecked; the signal aborts when the
   * dashboard closes or a setting changes.
   */
  check: (
    signal: AbortSignal,
    timeoutMs: number,
    skipped: ReadonlySet<string>,
  ) => Promise<CheckResult[]>;
  /** Called with the new settings each time the options panel changes one. */
  onSettingsChange?: (settings: DashboardSettings) => void;
  /** Called each time the service panel sets a service aside or brings it back. */
  onSkipChange?: (name: string, skip: boolean) => void;
}

/** The panel open under the list: the options, or the settings of one service. */
type Panel = { kind: "options"; row: number } | { kind: "service"; name: string; row: number };

const SERVICE_ROWS = ["Skip"];

const MARKER_WIDTH = 2;
const PANEL_WIDTH = 30;
// Border and padding on both sides of a panel line.
const PANEL_FRAME_WIDTH = 4;

const seconds = (ms: number) => `${ms / 1000}s`;

/**
 * Live list of the services, checked again `intervalMs` after each pass ends; `o` opens the options,
 * enter the settings of the selected service.
 * Colours come from `terminal`, never from ink props: ink does not honour `NO_COLOR`.
 */
export function Dashboard({
  terminal,
  settings: initial,
  skipped: initiallySkipped,
  check,
  onSettingsChange,
  onSkipChange,
}: DashboardProps) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [latest, setLatest] = useState<CheckResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [settings, setSettings] = useState(initial);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set(initiallySkipped));
  const [panel, setPanel] = useState<Panel | null>(null);
  const skipPause = useRef(() => {});
  const { intervalMs, timeoutMs } = settings;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loop = async () => {
      while (!signal.aborted) {
        const next = await check(signal, timeoutMs, skipped);
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
  }, [check, intervalMs, timeoutMs, skipped]);

  const last = (latest?.length ?? 1) - 1;
  const current = Math.min(selected, last);

  const change = (rowIndex: number, direction: 1 | -1) => {
    const row = SETTING_ROWS[rowIndex];
    if (!row) return;
    const value = stepChoice(row.choicesMs, settings[row.key], direction);
    if (value === settings[row.key]) return;
    const next = { ...settings, [row.key]: value };
    setSettings(next);
    onSettingsChange?.(next);
  };

  const toggleSkip = (name: string) => {
    const next = new Set(skipped);
    const skip = !next.delete(name);
    if (skip) next.add(name);
    setSkipped(next);
    onSkipChange?.(name, skip);
  };

  useInput((input, key) => {
    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    const left = key.leftArrow || input === "h";
    const right = key.rightArrow || input === "l";
    const selectedName = latest?.[current]?.name;
    if (input === "q") exit();
    else if (panel === null) {
      if (input === "r") skipPause.current();
      else if (input === "o") setPanel({ kind: "options", row: 0 });
      else if (key.return && selectedName)
        setPanel({ kind: "service", name: selectedName, row: 0 });
      else if (up) setSelected(Math.max(0, current - 1));
      else if (down) setSelected(Math.min(last, current + 1));
    } else if (key.escape || (panel.kind === "options" ? input === "o" : key.return))
      setPanel(null);
    else if (up || down) {
      const lastRow = (panel.kind === "options" ? SETTING_ROWS : SERVICE_ROWS).length - 1;
      setPanel({ ...panel, row: Math.max(0, Math.min(lastRow, panel.row + (down ? 1 : -1))) });
    } else if (left || right) {
      if (panel.kind === "options") change(panel.row, right ? 1 : -1);
      else toggleSkip(panel.name);
    }
  });

  const colors = createColors(terminal.color);
  const { unicode } = terminal;
  const dot = unicode ? "·" : "-";
  const marker = unicode ? "› " : "> ";
  const cut = (text: string) => truncate(text, Math.max(1, columns));

  if (!latest) return <Text>{cut("probe: checking…")}</Text>;

  // A service just set aside is shown as such at once, not when the pass that skips it ends.
  const results = latest.map((result): CheckResult => {
    if (result.skipped || !skipped.has(result.name)) return result;
    const { name, type, target } = result;
    return { name, type, target, ok: true, skipped: true, latencyMs: 0 };
  });

  const checked = results.filter((result) => !result.skipped);
  const up = checked.filter((result) => result.ok).length;
  const aside = results.length - checked.length;
  const summary = [
    "probe",
    `${up}/${checked.length} up`,
    ...(aside > 0 ? [`${aside} skipped`] : []),
    `every ${seconds(intervalMs)}`,
  ].join(` ${dot} `);
  const rows = formatCheckResults(results, {
    ...terminal,
    columns: Math.max(1, columns - MARKER_WIDTH),
  }).split("\n");
  const focused = results[current];
  const panelWidth = Math.min(PANEL_WIDTH, columns);
  const panelRows: [label: string, value: string][] =
    panel?.kind === "options"
      ? SETTING_ROWS.map((row) => [row.label, seconds(settings[row.key])])
      : panel
        ? SERVICE_ROWS.map((label) => [label, skipped.has(panel.name) ? "yes" : "no"])
        : [];
  const labelWidth = Math.max(0, ...panelRows.map(([label]) => label.length));
  const hint =
    panel === null
      ? `${unicode ? "↑↓ jk" : "jk"} move ${dot} r refresh ${dot} ${unicode ? "↵" : "enter"} service ${dot} o options ${dot} q quit`
      : `${unicode ? "↑↓ jk" : "jk"} move ${dot} ${unicode ? "←→ hl" : "hl"} change ${dot} esc close`;

  return (
    <Box flexDirection="column">
      <Text>{colors.bold(cut(summary))}</Text>
      {rows.map((row, index) => (
        <Text key={results[index]?.name}>
          {index === current ? marker : "  "}
          {row}
        </Text>
      ))}
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
      <Text>{colors.dim(cut(hint))}</Text>
    </Box>
  );
}
