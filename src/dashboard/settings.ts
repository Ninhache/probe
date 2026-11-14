import {
  DASHBOARD_INTERVAL_CHOICES_SECONDS,
  DASHBOARD_TIMEOUT_CHOICES_SECONDS,
} from "../constants";

/** What the options panel of the dashboard can change. */
export interface DashboardSettings {
  /** Pause between two passes of checks. */
  intervalMs: number;
  /** Time given to each service to answer. */
  timeoutMs: number;
}

export interface SettingRow {
  key: keyof DashboardSettings;
  label: string;
  choicesMs: number[];
}

const toMs = (seconds: number) => seconds * 1000;

export const SETTING_ROWS: SettingRow[] = [
  { key: "intervalMs", label: "Interval", choicesMs: DASHBOARD_INTERVAL_CHOICES_SECONDS.map(toMs) },
  { key: "timeoutMs", label: "Timeout", choicesMs: DASHBOARD_TIMEOUT_CHOICES_SECONDS.map(toMs) },
];

/**
 * Steps the timeout of one service, in seconds: `undefined` (the default) sits below the lowest choice.
 * A value that is not a choice (set by hand) moves to its neighbour.
 */
export function stepServiceTimeout(
  current: number | undefined,
  direction: 1 | -1,
): number | undefined {
  const choices = DASHBOARD_TIMEOUT_CHOICES_SECONDS;
  if (current === undefined) return direction === 1 ? choices[0] : undefined;
  if (direction === 1) return choices.find((choice) => choice > current) ?? current;
  return choices.findLast((choice) => choice < current);
}

/**
 * Returns the choice next to `current` (`direction` 1: the first one above, -1: the last one below).
 * `current` need not be a choice (`--interval 7`); at either end it is returned unchanged.
 */
export function stepChoice(choices: number[], current: number, direction: 1 | -1): number {
  const next =
    direction === 1
      ? choices.find((choice) => choice > current)
      : choices.findLast((choice) => choice < current);
  return next ?? current;
}
