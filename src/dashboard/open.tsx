import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import type { Config, Service } from "../config/schema";
import type { Terminal } from "../ui/terminal";
import { serviceActions } from "./actions";
import { Dashboard, type DashboardProps } from "./Dashboard";
import type { Saved } from "./saves";
import type { DashboardSettings } from "./settings";

export interface DashboardState {
  settings: DashboardSettings;
  /** Services set aside when the dashboard opens. */
  skipped: ReadonlySet<string>;
  /** Called each time the service panel sets the timeout of a service, in seconds; `undefined`: back to the default. */
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  /** Receives the settings each time the options panel changes one. */
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  /** Called each time the service panel sets a service aside or brings it back. */
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
  /**
   * Adds, edits or removes a service in `config.yml`. Resolves to the config as it is now,
   * or to why nothing was saved; `warning` is something to say next to what was done.
   */
  onServiceWrite?: (
    write: ServiceWrite,
  ) => Promise<{ config?: Config; failure?: string; warning?: string }>;
}

const pickFields = ({ host, port, path, expect }: Service): ServiceFields => ({
  host,
  port,
  path,
  expect,
});

/** Shows the dashboard on the alternate screen; resolves once it is closed (`q` or Ctrl+C). */
export async function openDashboard(
  initial: Config,
  terminal: Terminal,
  { onServiceWrite, ...state }: DashboardState,
): Promise<void> {
  // The dashboard adds, edits and removes services: everything reads the config as it is now.
  let config = initial;
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
    <Dashboard
      terminal={terminal}
      check={check}
      timeouts={timeouts}
      {...serviceActions(() => config)}
      {...state}
      serviceFields={(name) => {
        const service = config.services[name];
        return service && pickFields(service);
      }}
      onServiceWrite={
        onServiceWrite &&
        (async (write) => {
          const { config: written, ...outcome } = await onServiceWrite(write);
          if (written) config = written;
          return { ...outcome, saved: written !== undefined };
        })
      }
    />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
}
