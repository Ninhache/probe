import type { CheckResult } from "../checkers/types";

interface ServiceState {
  downSince?: number;
  /** Whether the user knows it is down: its return is only worth telling then. */
  told: boolean;
}

export type KnownStates = ReadonlyMap<string, ServiceState>;

export interface StateChange {
  name: string;
  up: boolean;
}

const UP: ServiceState = { told: false };

/** A service is reported down once it has stayed down for `graceMs`, and back up only if it was reported down. */
export function stateChanges(
  known: KnownStates,
  results: CheckResult[],
  now: number,
  graceMs: number,
): { known: KnownStates; changes: StateChange[] } {
  const next = new Map<string, ServiceState>();
  const changes: StateChange[] = [];
  for (const { name, ok, skipped } of results) {
    if (skipped) continue;
    const before = known.get(name);
    if (ok) {
      if (before?.told) changes.push({ name, up: true });
      next.set(name, UP);
      continue;
    }
    // Found down when first seen: nothing to tell, the screen opens on it.
    if (!before) {
      next.set(name, { downSince: now, told: true });
      continue;
    }
    const downSince = before.downSince ?? now;
    const due = !before.told && now - downSince >= graceMs;
    if (due) changes.push({ name, up: false });
    next.set(name, { downSince, told: before.told || due });
  }
  return { known: next, changes };
}

export function changeMessage(changes: StateChange[]): string {
  const [only] = changes;
  if (only && changes.length === 1) return `${only.name} is ${only.up ? "back up" : "down"}`;
  const names = (up: boolean) =>
    changes
      .filter((change) => change.up === up)
      .map(({ name }) => name)
      .join(", ");
  return [
    ...(names(false) ? [`down: ${names(false)}`] : []),
    ...(names(true) ? [`back up: ${names(true)}`] : []),
  ].join("; ");
}
