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
  /** Runs one pass of checks; the signal aborts when the dashboard closes or a setting changes. */
  check: (signal: AbortSignal, timeoutMs: number) => Promise<CheckResult[]>;
  /** Called with the new settings each time the options panel changes one. */
  onSettingsChange?: (settings: DashboardSettings) => void;
}

const MARKER_WIDTH = 2;
const PANEL_WIDTH = 30;
// Border and padding on both sides of a panel line.
const PANEL_FRAME_WIDTH = 4;

const seconds = (ms: number) => `${ms / 1000}s`;

/**
 * Live list of the services, checked again `intervalMs` after each pass ends; `o` opens the options.
 * Colours come from `terminal`, never from ink props: ink does not honour `NO_COLOR`.
 */
export function Dashboard({
  terminal,
  settings: initial,
  check,
  onSettingsChange,
}: DashboardProps) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [settings, setSettings] = useState(initial);
  const [options, setOptions] = useState<number | null>(null);
  const skipPause = useRef(() => {});
  const { intervalMs, timeoutMs } = settings;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loop = async () => {
      while (!signal.aborted) {
        const next = await check(signal, timeoutMs);
        if (signal.aborted) return;
        setResults(next);
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
  }, [check, intervalMs, timeoutMs]);

  const last = (results?.length ?? 1) - 1;
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

  useInput((input, key) => {
    const up = key.upArrow || input === "k";
    const down = key.downArrow || input === "j";
    if (input === "q") exit();
    else if (options === null) {
      if (input === "r") skipPause.current();
      else if (input === "o") setOptions(0);
      else if (up) setSelected(Math.max(0, current - 1));
      else if (down) setSelected(Math.min(last, current + 1));
    } else if (key.escape || input === "o") setOptions(null);
    else if (up) setOptions(Math.max(0, options - 1));
    else if (down) setOptions(Math.min(SETTING_ROWS.length - 1, options + 1));
    else if (key.leftArrow || input === "h") change(options, -1);
    else if (key.rightArrow || input === "l") change(options, 1);
  });

  const colors = createColors(terminal.color);
  const { unicode } = terminal;
  const dot = unicode ? "·" : "-";
  const marker = unicode ? "› " : "> ";
  const cut = (text: string) => truncate(text, Math.max(1, columns));

  if (!results) return <Text>{cut("probe: checking…")}</Text>;

  const up = results.filter((result) => result.ok).length;
  const rows = formatCheckResults(results, {
    ...terminal,
    columns: Math.max(1, columns - MARKER_WIDTH),
  }).split("\n");
  const focused = results[current];
  const panelWidth = Math.min(PANEL_WIDTH, columns);
  const labelWidth = Math.max(...SETTING_ROWS.map((row) => row.label.length));
  const hint =
    options === null
      ? `${unicode ? "↑↓ jk" : "jk"} move ${dot} r refresh ${dot} o options ${dot} q quit`
      : `${unicode ? "↑↓ jk" : "jk"} move ${dot} ${unicode ? "←→ hl" : "hl"} change ${dot} esc close`;

  return (
    <Box flexDirection="column">
      <Text>
        {colors.bold(
          cut(`probe ${dot} ${up}/${results.length} up ${dot} every ${seconds(intervalMs)}`),
        )}
      </Text>
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
      {options !== null && (
        <Box
          flexDirection="column"
          width={panelWidth}
          borderStyle={unicode ? "single" : "classic"}
          paddingX={1}
        >
          <Text>{colors.bold("Options")}</Text>
          {SETTING_ROWS.map((row, index) => {
            const value = seconds(settings[row.key]);
            const line = `${index === options ? marker : "  "}${row.label.padEnd(labelWidth)}  ${
              unicode ? `‹ ${value} ›` : `< ${value} >`
            }`;
            return (
              <Text key={row.key}>
                {truncate(line, Math.max(1, panelWidth - PANEL_FRAME_WIDTH))}
              </Text>
            );
          })}
        </Box>
      )}
      <Text>{colors.dim(cut(hint))}</Text>
    </Box>
  );
}
