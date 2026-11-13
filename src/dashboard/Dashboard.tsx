import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "../checkers/types";
import { createColors } from "../ui/colors";
import { formatCheckResults } from "../ui/report";
import { type Terminal, truncate } from "../ui/terminal";

export interface DashboardProps {
  terminal: Terminal;
  intervalMs: number;
  /** Runs one pass of checks; the signal aborts when the dashboard closes. */
  check: (signal: AbortSignal) => Promise<CheckResult[]>;
}

const MARKER_WIDTH = 2;

/**
 * Live list of the services, checked again `intervalMs` after each pass ends.
 * Colours come from `terminal`, never from ink props: ink does not honour `NO_COLOR`.
 */
export function Dashboard({ terminal, intervalMs, check }: DashboardProps) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [selected, setSelected] = useState(0);
  const skipPause = useRef(() => {});

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loop = async () => {
      while (!signal.aborted) {
        const next = await check(signal);
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
  }, [check, intervalMs]);

  const last = (results?.length ?? 1) - 1;
  const current = Math.min(selected, last);

  useInput((input, key) => {
    if (input === "q") exit();
    else if (input === "r") skipPause.current();
    else if (key.upArrow || input === "k") setSelected(Math.max(0, current - 1));
    else if (key.downArrow || input === "j") setSelected(Math.min(last, current + 1));
  });

  const colors = createColors(terminal.color);
  const dot = terminal.unicode ? "·" : "-";
  const cut = (text: string) => truncate(text, Math.max(1, columns));

  if (!results) return <Text>{cut("probe: checking…")}</Text>;

  const up = results.filter((result) => result.ok).length;
  const rows = formatCheckResults(results, {
    ...terminal,
    columns: Math.max(1, columns - MARKER_WIDTH),
  }).split("\n");
  const focused = results[current];
  const keys = terminal.unicode ? "↑↓ jk" : "jk";

  return (
    <Box flexDirection="column">
      <Text>
        {colors.bold(
          cut(`probe ${dot} ${up}/${results.length} up ${dot} every ${intervalMs / 1000}s`),
        )}
      </Text>
      {rows.map((row, index) => (
        <Text key={results[index]?.name}>
          {index === current ? (terminal.unicode ? "› " : "> ") : "  "}
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
      <Text>{colors.dim(cut(`${keys} move ${dot} r refresh ${dot} q quit`))}</Text>
    </Box>
  );
}
