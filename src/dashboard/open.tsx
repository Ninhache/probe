import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { Config } from "../config/schema";
import type { Terminal } from "../ui/terminal";
import { Dashboard } from "./Dashboard";
import type { DashboardSettings } from "./settings";

/**
 * Shows the dashboard on the alternate screen; resolves once it is closed (`q` or Ctrl+C).
 * `onSettingsChange` receives the settings each time the options panel changes one.
 */
export async function openDashboard(
  config: Config,
  terminal: Terminal,
  settings: DashboardSettings,
  onSettingsChange?: (settings: DashboardSettings) => void,
): Promise<void> {
  const check = (signal: AbortSignal, timeoutMs: number) =>
    runChecks(config, [], { timeoutMs, signal });
  const app = render(
    <Dashboard
      terminal={terminal}
      settings={settings}
      check={check}
      onSettingsChange={onSettingsChange}
    />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
}
