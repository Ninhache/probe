import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import type { Variables } from "../config/local";
import type { Config, Service } from "../config/schema";
import { CONFIG_FILE, PROBE_DIR } from "../constants";
import type { Terminal } from "../ui/terminal";
import { serviceActions } from "./actions";
import { Dashboard, type DashboardProps } from "./Dashboard";
import type { Saved } from "./saves";
import type { DashboardSettings } from "./settings";

export interface DashboardState {
  settings: DashboardSettings;
  skipped: ReadonlySet<string>;
  /** Reads the variables the headers refer to, before each pass: one set meanwhile is then seen. */
  variables?: () => Promise<Variables>;
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
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

export async function openDashboard(
  initial: Config,
  terminal: Terminal,
  { onServiceWrite, variables: readVariables, ...state }: DashboardState,
): Promise<void> {
  // The dashboard adds, edits and removes services: everything reads the config as it is now.
  let config = initial;
  const check: DashboardProps["check"] = async (signal, timeoutMs, skipped, timeouts) => {
    const services = Object.fromEntries(
      Object.entries(config.services).map(([name, service]) => [
        name,
        { ...service, timeout: timeouts[name] },
      ]),
    );
    const variables = await readVariables?.();
    return runChecks(
      { ...config, services },
      [],
      { timeoutMs, signal, detail: true, variables },
      skipped,
    );
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
        if (service?.url !== undefined) {
          return `${name} is declared by \`url\`: edit it in ${PROBE_DIR}/${CONFIG_FILE}`;
        }
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
