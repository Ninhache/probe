import { runChecks } from "../../checkers/run";
import type { Variables } from "../../config/local";
import {
  applySelection,
  mergedChoices,
  parameterChoices,
  type Selection,
} from "../../config/parameters";
import type { Config } from "../../config/schema";
import { NOTIFY_GRACE_SECONDS, RESPONSE_FULL_BODY_BYTES } from "../../constants";
import { App } from "../../tui/app";
import { type ActionDeps, serviceActions } from "../actions";
import { changeMessage, type KnownStates, stateChanges } from "../changes";
import { type EditCallbacks, liveEditing } from "../editing";
import { type FocusWatch, watchFocus } from "../focus";
import type { Saved } from "../saves";
import type { DashboardSettings } from "../settings";
import type { EnvironmentSource } from "../sources";
import { createEditor } from "./editor";
import { LOCAL_ENVIRONMENT, Tracker } from "./history";
import { type EnvironmentCheck, Monitor } from "./monitor";
import { handleInput, initialView, renderDashboard, say, type ViewState } from "./view";

export { LOCAL_ENVIRONMENT };

const MIN_SIZE = { w: 70, h: 16 };
const TICK_MS = 1000;

export interface NativeDashboardOptions extends EditCallbacks {
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
  /** Says whether the terminal window has the focus; by default asked of the terminal itself. */
  focus?: FocusWatch;
  /** Creates the file of a new environment, copied from `from`; absent where none can be created. */
  onEnvironmentCreate?: (
    name: string,
    from: string,
  ) => Promise<{ source: EnvironmentSource; message: string }>;
}

/** What the next pass runs with: the screen changes it while it runs. */
export type LiveState = Pick<ViewState, "settings" | "skipped" | "timeouts" | "selection">;

/** The check of an environment file, read again at each pass. */
export function sourceCheck(
  source: EnvironmentSource,
  live: () => LiveState,
  onLoaded: (env: string, declared: Config) => void,
): EnvironmentCheck {
  return {
    name: source.name,
    run: async (signal) => {
      const { config: declared, variables: loaded, skipped } = await source.load();
      onLoaded(source.name, declared);
      const now = live();
      return runChecks(
        declared,
        [],
        {
          timeoutMs: now.settings.timeoutMs,
          signal,
          detail: true,
          bodyBytes: RESPONSE_FULL_BODY_BYTES,
          variables: loaded,
          configFile: source.file,
          selection: now.selection,
        },
        skipped,
      );
    },
  };
}

export function environmentChecks(
  options: NativeDashboardOptions,
  live: () => LiveState = () => ({
    settings: options.settings,
    selection: options.selection ?? {},
    skipped: options.skipped ?? new Set(),
    timeouts: {},
  }),
  onLoaded: (env: string, declared: Config) => void = () => {},
): EnvironmentCheck[] {
  const { environments, variables } = options;
  // A screen that can add services keeps its own tab, empty or not.
  const hasLocal =
    Object.keys(options.config.services).length > 0 ||
    environments.length === 0 ||
    options.onServiceWrite !== undefined;
  const local: EnvironmentCheck[] = !hasLocal
    ? []
    : [
        {
          name: LOCAL_ENVIRONMENT,
          run: async (signal) => {
            const now = live();
            const { config } = options;
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
                bodyBytes: RESPONSE_FULL_BODY_BYTES,
                variables: await variables?.(),
                selection: now.selection,
              },
              now.skipped,
            );
          },
        },
      ];
  return [...local, ...environments.map((source) => sourceCheck(source, live, onLoaded))];
}

/** A window in focus shows the change itself: only one out of focus, or unknown, is notified. */
export const shouldNotify = (
  enabled: boolean | undefined,
  changes: number,
  focused: boolean | undefined,
) => enabled && changes > 0 && focused !== true;

export interface NotifierDeps {
  graceMs: number;
  enabled: () => boolean | undefined;
  focused: () => boolean | undefined;
  /** More than one environment is drawn: each change is named with its environment. */
  scoped: () => boolean;
  /** Shows the desktop notification; resolves to a warning when none could be shown. */
  tell: (message: string) => Promise<string | undefined>;
  warn: (warning: string) => void;
  now?: () => number;
}

/** Turns each environment's passes into desktop notifications: nothing at start, each change once. */
export function createNotifier({ graceMs, now = Date.now, ...deps }: NotifierDeps) {
  const known = new Map<string, KnownStates>();
  let warned = false;
  return {
    observe(env: string, results: Parameters<typeof stateChanges>[1]) {
      const { known: after, changes } = stateChanges(
        known.get(env) ?? new Map(),
        results,
        now(),
        graceMs,
      );
      known.set(env, after);
      if (!shouldNotify(deps.enabled(), changes.length, deps.focused())) return;
      const scope = deps.scoped() ? `${env}/` : "";
      const named = changes.map((change) => ({ ...change, name: `${scope}${change.name}` }));
      void deps.tell(changeMessage(named)).then((warning) => {
        // A notifier that cannot show anything would say so at every change.
        if (!warning || warned) return;
        warned = true;
        deps.warn(warning);
      });
    },
    /** Forgets what was known, so the next pass is a start again. */
    reset: () => known.clear(),
  };
}

/** The parameters of the local config, then those the environments' files declare as read last. */
export function mergedParameters(local: Config, others: Iterable<Config>) {
  return mergedChoices([parameterChoices(local), ...[...others].map(parameterChoices)]);
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
  const editing = liveEditing(options.config, options);
  view.canAdd = editing.writeService !== undefined;
  view.canEditParameters = editing.writeParameter !== undefined;
  // The writes and the undos replace the config: a pass reads it as it is when it starts.
  const live: NativeDashboardOptions = {
    ...options,
    get config() {
      return editing.config();
    },
  };
  const loaded = new Map<string, Config>();
  // Parameters an environment's file declares join the local ones.
  const merge = () => mergedParameters(editing.config(), loaded.values());
  const checks = environmentChecks(
    live,
    () => view,
    (env, declared) => {
      loaded.set(env, declared);
      view.choices = merge();
    },
  );
  const tracker = new Tracker(checks.map((check) => check.name));
  const sources = new Map(options.environments.map((source) => [source.name, source]));
  const graceMs = NOTIFY_GRACE_SECONDS * 1000;
  const configOf = async (env: string): Promise<Config | undefined> =>
    env === LOCAL_ENVIRONMENT ? editing.config() : (await sources.get(env)?.load())?.config;
  const focus = options.focus ?? watchFocus(process.stdin, process.stdout);
  const track = (saved: Saved | undefined) =>
    void saved?.then((why) => {
      view.unsaved = why;
      if (why) say(view, why);
    });
  const system = (cfg: Config) =>
    serviceActions((selection?: Selection) => applySelection(cfg, selection), options.deps);
  return new Promise((resolve) => {
    const notify = createNotifier({
      graceMs,
      enabled: () => view.settings.notify,
      focused: () => focus.focused(),
      scoped: () => tracker.environments.length > 1,
      tell: (message) => system(editing.config()).onNotify(message),
      warn: (warning) => {
        if (!view.status) say(view, warning);
      },
    });
    const monitor = new Monitor(checks, {
      intervalMs: options.settings.intervalMs,
      onResults: (env, results) => {
        // A pass that began before a removal still reports the service.
        const current =
          env === LOCAL_ENVIRONMENT
            ? results.filter(({ name }) => Object.hasOwn(editing.config().services, name))
            : results;
        tracker.record(env, current);
        notify.observe(env, current);
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
    const created = options.onEnvironmentCreate;
    const createEnvironment =
      created &&
      (async (name: string, from: string) => {
        const { source, message } = await created(name, from);
        sources.set(name, source);
        tracker.add(name);
        view.tab = tracker.environments.indexOf(name) + 1;
        monitor.add(
          sourceCheck(
            source,
            () => view,
            (env, declared) => {
              loaded.set(env, declared);
              view.choices = merge();
            },
          ),
        );
        app.requestRender();
        return message;
      });
    const edit = createEditor({
      createEnvironment,
      view,
      tracker,
      editing,
      fileOf: (env) => sources.get(env)?.file,
      redraw: () => app.requestRender(),
      declaredIn: (name) =>
        [...loaded]
          .filter(([, declared]) => Object.hasOwn(declared.parameters ?? {}, name))
          .flatMap(([env]) => sources.get(env)?.file ?? []),
      changed: (restart) => {
        if (restart) {
          tracker.reset();
          notify.reset();
        }
        view.choices = merge();
        tracker.retain(LOCAL_ENVIRONMENT, new Set(Object.keys(editing.config().services)));
        monitor.invalidate();
        monitor.refresh();
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
          edit,
          redraw: () => app.requestRender(),
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
          copyResponse: (text, cut, part) =>
            void system(editing.config())
              .onCopyResponse(text, cut, part)
              .then((message) => {
                say(view, message);
                app.requestRender();
              }),
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
            notify.reset();
            monitor.invalidate();
            monitor.refresh();
          },
        }),
      onStop: () => {
        monitor.stop();
        focus.stop();
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
