import {
  DASHBOARD_INTERVAL_CHOICES_SECONDS,
  DASHBOARD_TIMEOUT_CHOICES_SECONDS,
} from "../constants";

export interface DashboardSettings {
  intervalMs: number;
  timeoutMs: number;
  notify?: boolean;
}

export interface SettingRow {
  key: "intervalMs" | "timeoutMs";
  label: string;
  choicesMs: number[];
}

const toMs = (seconds: number) => seconds * 1000;

export const SETTING_ROWS: SettingRow[] = [
  { key: "intervalMs", label: "Interval", choicesMs: DASHBOARD_INTERVAL_CHOICES_SECONDS.map(toMs) },
  { key: "timeoutMs", label: "Timeout", choicesMs: DASHBOARD_TIMEOUT_CHOICES_SECONDS.map(toMs) },
];

export function stepServiceTimeout(
  current: number | undefined,
  direction: 1 | -1,
): number | undefined {
  const choices = DASHBOARD_TIMEOUT_CHOICES_SECONDS;
  if (current === undefined) return direction === 1 ? choices[0] : undefined;
  if (direction === 1) return choices.find((choice) => choice > current) ?? current;
  return choices.findLast((choice) => choice < current);
}

export function stepChoice(choices: number[], current: number, direction: 1 | -1): number {
  const next =
    direction === 1
      ? choices.find((choice) => choice > current)
      : choices.findLast((choice) => choice < current);
  return next ?? current;
}
