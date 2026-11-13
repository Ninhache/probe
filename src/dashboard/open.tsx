import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { Config } from "../config/schema";
import { DASHBOARD_INTERVAL_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../constants";
import type { Terminal } from "../ui/terminal";
import { Dashboard } from "./Dashboard";

/** Shows the dashboard on the alternate screen; resolves once it is closed (`q` or Ctrl+C). */
export async function openDashboard(config: Config, terminal: Terminal): Promise<void> {
  const timeoutMs = DEFAULT_TIMEOUT_SECONDS * 1000;
  const check = (signal: AbortSignal) => runChecks(config, [], { timeoutMs, signal });
  const app = render(
    <Dashboard terminal={terminal} intervalMs={DASHBOARD_INTERVAL_SECONDS * 1000} check={check} />,
    { alternateScreen: true },
  );
  await app.waitUntilExit();
}
