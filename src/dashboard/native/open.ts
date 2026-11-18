import { runChecks } from "../../checkers/run";
import type { Variables } from "../../config/local";
import { applySelection, parameterChoices, type Selection } from "../../config/parameters";
import type { Config } from "../../config/schema";
import { NOTIFY_GRACE_SECONDS } from "../../constants";
import { App } from "../../tui/app";
import { type ActionDeps, serviceActions } from "../actions";
import { changeMessage, type KnownStates, stateChanges } from "../changes";
import type { Saved } from "../saves";
import type { DashboardSettings } from "../settings";
import type { EnvironmentSource } from "../sources";
import { LOCAL_ENVIRONMENT, Tracker } from "./history";
import { type EnvironmentCheck, Monitor } from "./monitor";
import { handleInput, initialView, renderDashboard, say, type ViewState } from "./view";

export { LOCAL_ENVIRONMENT };

const MIN_SIZE = { w: 70, h: 16 };
const TICK_MS = 1000;

export interface NativeDashboardOptions {
  config: Config;
  environments: readonly EnvironmentSource[];
  settings: DashboardSettings;
  selection?: Selection;
  variables?: () => Promise<Variables>;
  /** Services of config.yml set aside by local.yml. */
  skipped?: ReadonlySet<string>;
  /** Each writes local.yml or config.yml and resolves to why it could not, if so. */
  onSkipChange?: (name: string, skip: boolean) => Saved | undefined;
  onTimeoutChange?: (name: string, seconds: number | undefined) => Saved | undefined;
  onSettingsChange?: (settings: DashboardSettings) => Saved | undefined;
  onParameterChange?: (name: string, value: string) => Saved | undefined;
  /** The system (browser, clipboard, notifications); replaced in tests. */
  deps?: ActionDeps;
}

/** What the next pass runs with: the screen changes it while it runs. */
export type LiveState = Pick<ViewState, "settings" | "skipped" | "timeouts" | "selection">;

export function environmentChecks(
  { config, environments, settings, selection, variables, skipped }: NativeDashboardOptions,
  live: () => LiveState = () => ({
    settings,
    selection: selection ?? {},
    skipped: skipped ?? new Set(),
    timeouts: {},
  }),
): EnvironmentCheck[] {
  const local: EnvironmentCheck[] =
    Object.keys(config.services).length === 0
      ? []
      : [
          {
            name: LOCAL_ENVIRONMENT,
            run: async (signal) => {
              const now = live();
              const services = Object.fromEntries(
                Object.entries(config.services).map(([name, service]) => [
                  name,
                  { ...service, timeout: now.timeouts[name] },
                ]),
              );
              return runChecks(
                { ...config, services },
                [],
                {
                  timeoutMs: now.settings.timeoutMs,
                  signal,
                  detail: true,
                  variables: await variables?.(),
                  selection: now.selection,
                },
                now.skipped,
              );
            },
          },
        ];
  return [
    ...local,
    ...environments.map(
      (source): EnvironmentCheck => ({
        name: source.name,
        run: async (signal) => {
          const { config: declared, variables: loaded, skipped } = await source.load();
          const now = live();
          return runChecks(
            declared,
            [],
            {
              timeoutMs: now.settings.timeoutMs,
              signal,
              detail: true,
              variables: loaded,
              configFile: source.file,
              selection: now.selection,
            },
            skipped,
          );
        },
      }),
    ),
  ];
}

/** The btop-style dashboard drawn by the zero-dependency engine. Resolves once the terminal is restored. */
export function openNativeDashboard(options: NativeDashboardOptions): Promise<void> {
  const view = initialView({
    settings: options.settings,
    skipped: options.skipped,
    selection: options.selection,
    choices: parameterChoices(options.config),
    timeouts: Object.fromEntries(
      Object.entries(options.config.services).map(([name, { timeout }]) => [name, timeout]),
    ),
  });
  const checks = environmentChecks(options, () => view);
  const tracker = new Tracker(checks.map((check) => check.name));
  const sources = new Map(options.environments.map((source) => [source.name, source]));
  const known = new Map<string, KnownStates>();
  const graceMs = NOTIFY_GRACE_SECONDS * 1000;
  const configOf = async (env: string): Promise<Config | undefined> =>
    env === LOCAL_ENVIRONMENT ? options.config : (await sources.get(env)?.load())?.config;
  const track = (saved: Saved | undefined) => void saved?.then((why) => why && say(view, why));
  const system = (cfg: Config) =>
    serviceActions((selection?: Selection) => applySelection(cfg, selection), options.deps);
  return new Promise((resolve) => {
    const notify = (env: string, results: Parameters<typeof stateChanges>[1]) => {
      const { known: after, changes } = stateChanges(
        known.get(env) ?? new Map(),
        results,
        Date.now(),
        graceMs,
      );
      known.set(env, after);
      if (!view.settings.notify || changes.length === 0) return;
      const scope = tracker.environments.length > 1 ? `${env}/` : "";
      const named = changes.map((change) => ({ ...change, name: `${scope}${change.name}` }));
      void system(options.config)
        .onNotify(changeMessage(named))
        .then((warning) => warning && !view.status && say(view, warning));
    };
    const monitor = new Monitor(checks, {
      intervalMs: options.settings.intervalMs,
      onResults: (env, results) => {
        tracker.record(env, results);
        notify(env, results);
        app.requestRender();
      },
      onFailure: (env, message) => {
        tracker.recordFailure(env, message);
        app.requestRender();
      },
    });
    const run = async (env: string, work: (cfg: Config) => Promise<string>) => {
      const cfg = await configOf(env);
      say(view, cfg ? await work(cfg) : `${env} cannot be read`);
      app.requestRender();
    };
    const app: App = new App({
      render: (screen, area) => {
        view.frame = app.frame;
        renderDashboard(screen, area, tracker, view);
      },
      onInput: (event) =>
        handleInput(event, tracker, view, {
          quit: () => app.stop(),
          refresh: () => monitor.refresh(),
          open: (service, env) =>
            void run(env, (cfg) => system(cfg).onOpen(service, view.selection)),
          copy: (service, env) =>
            void run(env, (cfg) =>
              system(cfg).onCopy(
                service,
                env === LOCAL_ENVIRONMENT ? view.timeouts[service] : cfg.services[service]?.timeout,
                view.selection,
              ),
            ),
          skip: (service, skip) => {
            track(options.onSkipChange?.(service, skip));
            monitor.refresh();
          },
          timeout: (service, seconds) => {
            track(options.onTimeoutChange?.(service, seconds));
            monitor.refresh();
          },
          settings: (next) => {
            track(options.onSettingsChange?.(next));
            monitor.setInterval(next.intervalMs);
          },
          parameter: (name, value) => {
            track(options.onParameterChange?.(name, value));
            // Another value is another target: the latencies and the states start again.
            tracker.reset();
            known.clear();
            monitor.refresh();
          },
        }),
      onStop: () => {
        monitor.stop();
        resolve();
      },
      tickMs: TICK_MS,
      mouse: true,
      minSize: MIN_SIZE,
    });
    monitor.start();
    app.start();
  });
}
