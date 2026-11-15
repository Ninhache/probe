import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import { serviceVariables } from "../config/headers";
import type { Variables } from "../config/local";
import type { Config, Service } from "../config/schema";
import { CONFIG_FILE, PROBE_DIR } from "../constants";
import type { Terminal } from "../ui/terminal";
import { serviceActions } from "./actions";
import { Dashboard, type DashboardProps, type Secrets } from "./Dashboard";
import type { Saved } from "./saves";
import type { DashboardSettings } from "./settings";
import { type VariableSources, variableTools } from "./variables";

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
    secrets?: Secrets,
  ) => Promise<{ config?: Config; failure?: string; warning?: string }>;
  variableSources?: VariableSources;
  onVariableWrite?: (name: string, value: string) => Saved;
}

const pickFields = ({ host, port, path, expect, headers }: Service): ServiceFields => ({
  host,
  port,
  path,
  expect,
  headers,
});

export async function openDashboard(
  initial: Config,
  terminal: Terminal,
  { onServiceWrite, variables: readVariables, variableSources, ...state }: DashboardState,
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
  const tools = variableSources && variableTools(() => config, variableSources);
  const unsetNote = async (name: string) => {
    const sent = serviceVariables(config.services[name]?.headers);
    const found = (await variableSources?.(sent)) ?? {};
    const unset = sent.filter((variable) => !found[variable]);
    if (!variableSources || unset.length === 0) return undefined;
    return `${unset.join(", ")} not set: open ${name} with enter, then enter on the variable`;
  };
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
        (async (write, secrets) => {
          const { config: written, ...outcome } = await onServiceWrite(write, secrets);
          if (written) config = written;
          const notes = [outcome.warning, written && (await unsetNote(write.name))];
          const warning = notes.filter(Boolean).join("\n") || undefined;
          return { ...outcome, warning, saved: written !== undefined };
        })
      }
      variables={tools}
    />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
}
