import { render } from "ink";
import { runChecks } from "../checkers/run";
import type { Variables } from "../config/local";
import { applySelection, parameterChoices, type Selection } from "../config/parameters";
import type { Config } from "../config/schema";
import type { Terminal } from "../ui/terminal";
import { type ActionDeps, serviceActions } from "./actions";
import { Dashboard, type DashboardProps, type EnvironmentColumn } from "./Dashboard";
import { type EditCallbacks, liveEditing, timeoutsOf } from "./editing";
import { watchFocus } from "./focus";
import type { Saved } from "./saves";
import type { DashboardSettings } from "./settings";
import { type EnvironmentSource, environmentSource } from "./sources";

export { type EnvironmentSource, environmentSource };

export interface DashboardState extends EditCallbacks {
  settings: DashboardSettings;
  skipped: ReadonlySet<string>;
  /** Reads the variables the headers refer to, before each pass: one set meanwhile is then seen. */
  variables?: () => Promise<Variables>;
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
  selection?: Selection;
  onParameterChange?: (name: string, value: string) => Saved | undefined;
  environments?: readonly EnvironmentSource[];
}

export function environmentColumn(
  { name, file, load }: EnvironmentSource,
  deps?: ActionDeps,
): EnvironmentColumn {
  let known: Config | undefined;
  const { onOpen, onCopy } = serviceActions(
    (selection) => applySelection(known ?? { schemaVersion: 1, services: {} }, selection),
    deps,
  );
  return {
    name,
    file,
    onOpen,
    onCopy: (service, selection) => onCopy(service, known?.services[service]?.timeout, selection),
    parameters: () => (known ? parameterChoices(known) : {}),
    async check(signal, timeoutMs, selection) {
      const { config, variables, skipped } = await load();
      known = config;
      return runChecks(
        config,
        [],
        { timeoutMs, signal, detail: true, variables, configFile: file, selection },
        skipped,
      );
    },
  };
}

export async function openDashboard(
  initial: Config,
  terminal: Terminal,
  {
    onServiceWrite,
    onParameterWrite,
    variables: readVariables,
    variableSources,
    onVariableWrite,
    environments = [],
    onUndo,
    onRedo,
    ...state
  }: DashboardState,
): Promise<void> {
  // The dashboard adds, edits and removes services: everything reads the config as it is now.
  const editing = liveEditing(initial, {
    onServiceWrite,
    onParameterWrite,
    onUndo,
    onRedo,
    variableSources,
    onVariableWrite,
  });
  const check: DashboardProps["check"] = async (
    signal,
    timeoutMs,
    skipped,
    timeouts,
    selection,
  ) => {
    const config = editing.config();
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
      { timeoutMs, signal, detail: true, variables, selection },
      skipped,
    );
  };
  const timeouts = timeoutsOf(initial);
  const focus = watchFocus(process.stdin, process.stdout);
  const app = render(
    <Dashboard
      terminal={terminal}
      check={check}
      timeouts={timeouts}
      {...serviceActions((selection) => applySelection(editing.config(), selection))}
      parameters={() => parameterChoices(editing.config())}
      {...state}
      terminalFocused={focus.focused}
      onClose={focus.stop}
      serviceForm={editing.serviceForm}
      serviceFields={editing.serviceFields}
      onServiceWrite={editing.writeService}
      onUndo={editing.undo}
      onRedo={editing.redo}
      parameterFields={editing.parameterFields}
      addresses={editing.addresses}
      urlParameter={editing.urlParameter}
      onParameterWrite={editing.writeParameter}
      onVariableWrite={editing.writeVariable}
      variables={editing.variables}
      environments={environments.map((source) => environmentColumn(source))}
    />,
    // Rewrites only the lines that changed: a key press sends ~0.5 kB instead of the whole screen.
    { alternateScreen: true, incrementalRendering: true },
  );
  try {
    await app.waitUntilExit();
  } finally {
    focus.stop();
  }
}
