import { runChecks } from "../../checkers/run";
import type { Variables } from "../../config/local";
import type { Selection } from "../../config/parameters";
import type { Config } from "../../config/schema";
import { App } from "../../tui/app";
import type { DashboardSettings } from "../settings";
import type { EnvironmentSource } from "../sources";
import { Tracker } from "./history";
import { type EnvironmentCheck, Monitor } from "./monitor";
import { handleInput, initialView, renderDashboard } from "./view";

/** The environment name of the services declared in `.probe/config.yml`. */
export const LOCAL_ENVIRONMENT = "local";
const MIN_SIZE = { w: 70, h: 16 };
const TICK_MS = 1000;

export interface NativeDashboardOptions {
  config: Config;
  environments: readonly EnvironmentSource[];
  settings: DashboardSettings;
  selection?: Selection;
  variables?: () => Promise<Variables>;
}

export function environmentChecks({
  config,
  environments,
  settings,
  selection,
  variables,
}: NativeDashboardOptions): EnvironmentCheck[] {
  const local: EnvironmentCheck[] =
    Object.keys(config.services).length === 0
      ? []
      : [
          {
            name: LOCAL_ENVIRONMENT,
            run: async (signal) =>
              runChecks(config, [], {
                timeoutMs: settings.timeoutMs,
                signal,
                variables: await variables?.(),
                selection,
              }),
          },
        ];
  return [
    ...local,
    ...environments.map(
      (source): EnvironmentCheck => ({
        name: source.name,
        run: async (signal) => {
          const { config: declared, variables: loaded, skipped } = await source.load();
          return runChecks(
            declared,
            [],
            {
              timeoutMs: settings.timeoutMs,
              signal,
              variables: loaded,
              configFile: source.file,
              selection,
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
  const checks = environmentChecks(options);
  const tracker = new Tracker(checks.map((check) => check.name));
  const view = initialView();
  return new Promise((resolve) => {
    const monitor = new Monitor(checks, {
      intervalMs: options.settings.intervalMs,
      onResults: (env, results) => {
        tracker.record(env, results);
        app.requestRender();
      },
      onFailure: (env, message) => {
        tracker.recordFailure(env, message);
        app.requestRender();
      },
    });
    const app: App = new App({
      render: (screen, area) => {
        view.frame = app.frame;
        renderDashboard(screen, area, tracker, view);
      },
      onInput: (event) =>
        handleInput(event, tracker, view, {
          quit: () => app.stop(),
          refresh: () => monitor.refresh(),
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
