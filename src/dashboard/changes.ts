import type { CheckResult } from "../checkers/types";

export type KnownStates = ReadonlyMap<string, boolean>;

export interface StateChange {
  name: string;
  up: boolean;
}

export function stateChanges(
  known: KnownStates,
  results: CheckResult[],
): { known: KnownStates; changes: StateChange[] } {
  const checked = results.filter(({ skipped }) => !skipped);
  return {
    known: new Map(checked.map(({ name, ok }) => [name, ok])),
    changes: checked
      .filter(({ name, ok }) => known.has(name) && known.get(name) !== ok)
      .map(({ name, ok }) => ({ name, up: ok })),
  };
}

// Names the services only: what a server answered stays on the screen of the dashboard.
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
