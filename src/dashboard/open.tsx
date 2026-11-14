import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { Config } from "../config/schema";
import type { Terminal } from "../ui/terminal";
import { Dashboard } from "./Dashboard";
import type { DashboardSettings } from "./settings";

export interface DashboardState {
  settings: DashboardSettings;
  /** Services set aside when the dashboard opens. */
  skipped: ReadonlySet<string>;
  /** Receives the settings each time the options panel changes one. */
  onSettingsChange?: (settings: DashboardSettings) => void;
  /** Called each time the service panel sets a service aside or brings it back. */
  onSkipChange?: (name: string, skip: boolean) => void;
}

/** Shows the dashboard on the alternate screen; resolves once it is closed (`q` or Ctrl+C). */
export async function openDashboard(
  config: Config,
  terminal: Terminal,
  state: DashboardState,
): Promise<void> {
  const check = (signal: AbortSignal, timeoutMs: number, skipped: ReadonlySet<string>) =>
    runChecks(config, [], { timeoutMs, signal }, skipped);
  const app = render(<Dashboard terminal={terminal} check={check} {...state} />, {
    alternateScreen: true,
  });
  await app.waitUntilExit();
}
