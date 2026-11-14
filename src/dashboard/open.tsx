import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { Config } from "../config/schema";
import type { Terminal } from "../ui/terminal";
import { Dashboard, type DashboardProps } from "./Dashboard";
import type { DashboardSettings } from "./settings";

export interface DashboardState {
  settings: DashboardSettings;
  /** Services set aside when the dashboard opens. */
  skipped: ReadonlySet<string>;
  /** Called each time the service panel sets the timeout of a service, in seconds; `undefined`: back to the default. */
  onTimeoutChange?: (name: string, seconds: number | undefined) => void;
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
  const check: DashboardProps["check"] = (signal, timeoutMs, skipped, timeouts) => {
    const services = Object.fromEntries(
      Object.entries(config.services).map(([name, service]) => [
        name,
        { ...service, timeout: timeouts[name] },
      ]),
    );
    return runChecks({ ...config, services }, [], { timeoutMs, signal }, skipped);
  };
  const timeouts = Object.fromEntries(
    Object.entries(config.services).flatMap(([name, { timeout }]) =>
      timeout === undefined ? [] : [[name, timeout]],
    ),
  );
  const app = render(
    <Dashboard terminal={terminal} check={check} timeouts={timeouts} {...state} />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
}
