import { render } from "ink";
import { defaultType, serviceType } from "../checkers/registry";
import { runChecks } from "../checkers/run";
import type { ParameterProblem, ParameterWrite } from "../commands/parameter-writes";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import type { ProbePaths } from "../config/discovery";
import { environmentPaths } from "../config/environments";
import { serviceVariables } from "../config/headers";
import { loadConfig } from "../config/loader";
import { loadVariables, readSkippedServices, type Variables } from "../config/local";
import { applySelection, parameterChoices, type Selection } from "../config/parameters";
import type { Config, Service } from "../config/schema";
import { CONFIG_FILE, ENVIRONMENTS_DIR, PROBE_DIR } from "../constants";
import type { Terminal } from "../ui/terminal";
import { type ActionDeps, serviceActions } from "./actions";
import { Dashboard, type DashboardProps, type EnvironmentColumn, type Secrets } from "./Dashboard";
import { watchFocus } from "./focus";
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
  selection?: Selection;
  onParameterChange?: (name: string, value: string) => Saved | undefined;
  onServiceWrite?: (
    write: ServiceWrite,
    secrets?: Secrets,
  ) => Promise<{ config?: Config; failure?: string; warning?: string }>;
  onParameterWrite?: (
    write: ParameterWrite,
  ) => Promise<{ config?: Config; problem?: ParameterProblem; failure?: string }>;
  variableSources?: VariableSources;
  onVariableWrite?: (name: string, value: string) => Saved;
  environments?: readonly EnvironmentSource[];
}

export interface EnvironmentSource {
  name: string;
  file: string;
  /** Read before each pass: the file is edited by hand while the dashboard runs. */
  load: () => Promise<{ config: Config; variables: Variables; skipped: ReadonlySet<string> }>;
}

export function environmentSource(
  paths: ProbePaths,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentSource {
  return {
    name,
    file: `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${name}.yml`,
    async load() {
      const found = await environmentPaths(paths, name);
      // Not on stderr: a line printed there would land in the middle of the screen.
      const loaded = await loadConfig(found, { log: () => {} });
      return {
        config: loaded.config,
        variables: await loadVariables(found, env),
        skipped: await readSkippedServices(found),
      };
    },
  };
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

const pickFields = ({ host, port, path, expect, method, headers }: Service): ServiceFields => ({
  host,
  port,
  path,
  expect,
  method,
  headers,
});

export async function openDashboard(
  initial: Config,
  terminal: Terminal,
  {
    onServiceWrite,
    onParameterWrite,
    variables: readVariables,
    variableSources,
    environments = [],
    ...state
  }: DashboardState,
): Promise<void> {
  // The dashboard adds, edits and removes services: everything reads the config as it is now.
  let config = initial;
  const check: DashboardProps["check"] = async (
    signal,
    timeoutMs,
    skipped,
    timeouts,
    selection,
  ) => {
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
  const focus = watchFocus(process.stdin, process.stdout);
  const app = render(
    <Dashboard
      terminal={terminal}
      check={check}
      timeouts={timeouts}
      {...serviceActions((selection) => applySelection(config, selection))}
      parameters={() => parameterChoices(config)}
      {...state}
      terminalFocused={focus.focused}
      onClose={focus.stop}
      serviceForm={(name) => {
        const service = name === undefined ? undefined : config.services[name];
        return (service ? serviceType(service) : defaultType()).form;
      }}
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
      parameterFields={(name) => config.parameters?.[name]}
      addresses={() =>
        Object.fromEntries(
          Object.entries(config.services).map(([name, service]) => [name, { ...service.urls }]),
        )
      }
      urlParameter={() => {
        const found = Object.entries(config.parameters ?? {}).find(
          ([, { strategy }]) => strategy.kind === "url",
        );
        return found && { name: found[0], values: found[1].values };
      }}
      onParameterWrite={
        onParameterWrite &&
        (async (write) => {
          const { config: written, ...outcome } = await onParameterWrite(write);
          if (written) config = written;
          return { ...outcome, saved: written !== undefined };
        })
      }
      variables={tools}
      environments={environments.map((source) => environmentColumn(source))}
    />,
    { alternateScreen: true },
  );
  try {
    await app.waitUntilExit();
  } finally {
    focus.stop();
  }
}
