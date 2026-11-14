import { render } from "ink";
import { curlCommand, targetUrl } from "../checkers/http";
import { runChecks } from "../checkers/run";
import { clipboardTools, copyText } from "../clipboard";
import type { Config } from "../config/schema";
import { openerCommand, openUrl } from "../open-url";
import type { Terminal } from "../ui/terminal";
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
  const service = (name: string) => config.services[name] as Config["services"][string];
  const onOpen: DashboardProps["onOpen"] = async (name) => {
    const url = targetUrl(service(name));
    return (await openUrl(url))
      ? `Opened ${url}`
      : `${openerCommand(process.platform)} not found, open it yourself: ${url}`;
  };
  const onCopy: DashboardProps["onCopy"] = async (name, timeout) => {
    const command = curlCommand({ ...service(name), timeout });
    if (await copyText(command)) return `Copied: ${command}`;
    const tools = clipboardTools(process.platform, process.env).map(([tool]) => tool);
    return `Not copied (no ${tools.join(" or ")}), copy it yourself: ${command}`;
  };
  const app = render(
    <Dashboard
      terminal={terminal}
      check={check}
      timeouts={timeouts}
      onOpen={onOpen}
      onCopy={onCopy}
      {...state}
    />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
}
