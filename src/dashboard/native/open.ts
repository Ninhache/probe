import { runChecks } from "../../checkers/run";
import type { EnvironmentOrigin } from "../../commands/env-create";
import type { Variables } from "../../config/local";
import {
  localMismatches,
  mismatchMessages,
  type ServiceOverrides,
  withOverrides,
} from "../../config/overrides";
import {
  applySelection,
  mergedChoices,
  parameterChoices,
  type Selection,
} from "../../config/parameters";
import type { Config } from "../../config/schema";
import { CONFIG_FILE, NOTIFY_GRACE_SECONDS, RESPONSE_FULL_BODY_BYTES } from "../../constants";
import { App } from "../../tui/app";
import { supportsUnicode } from "../../ui/terminal";
import type { News } from "../../update/whats-new";
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
import { whatsNewModal } from "./news";
import { handleInput, initialView, renderDashboard, say, type ViewState } from "./view";

export { LOCAL_ENVIRONMENT };

const MIN_SIZE = { w: 60, h: 16 };
const TICK_MS = 1000;

export interface NativeDashboardOptions extends EditCallbacks {
  /** Writes a trace file and returns the notice: only `w` calls it, and it is not undoable. */
  onTraceSave?: (service: string, text: string) => Promise<string>;
  config: Config;
  environments: readonly EnvironmentSource[];
  settings: DashboardSettings;
  selection?: Selection;
  /** The project root, where the command services run. */
  cwd?: string;
  variables?: () => Promise<Variables>;
  /** The values local.yml gives the services, read before each pass: checked, never edited. */
  overrides?: () => Promise<ServiceOverrides>;
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
    from: EnvironmentOrigin,
  ) => Promise<{ source: EnvironmentSource; message: string }>;
  /** Deletes the file of an environment, undoably; resolves to why it could not. */
  onEnvironmentRemove?: (name: string) => Promise<string | undefined>;
  /** The release notes: `show` opens with the dashboard, `again` is read on demand (W). */
  whatsNew?: { show?: News; again: () => News | undefined };
  /** The environments declared now: an undo or a redo can bring a tab back or take it away. */
  onEnvironmentsList?: () => Promise<EnvironmentSource[]>;
}

/** What the next pass runs with: the screen changes it while it runs. */
export type LiveState = Pick<ViewState, "settings" | "skipped" | "timeouts" | "selection">;

/** Told the services local.yml adds to an environment, as a pass starts. */
export type OnAdded = (env: string, names: ReadonlySet<string>) => void;

const addedNames = (declared: Config, checked: Config): ReadonlySet<string> =>
  new Set(Object.keys(checked.services).filter((name) => !Object.hasOwn(declared.services, name)));

/** The check of an environment file, read again at each pass. */
export function sourceCheck(
  source: EnvironmentSource,
  live: () => LiveState,
  onLoaded: (env: string, declared: Config) => void,
  cwd?: string,
  onAdded: OnAdded = () => {},
): EnvironmentCheck {
  return {
    name: source.name,
    run: async (signal) => {
      const { config: declared, variables: loaded, skipped, overrides } = await source.load();
      onLoaded(source.name, declared);
      const checked = withOverrides(declared, overrides);
      onAdded(source.name, addedNames(declared, checked));
      const now = live();
      return runChecks(
        checked,
        [],
        {
          timeoutMs: now.settings.timeoutMs,
          signal,
          detail: true,
          bodyBytes: RESPONSE_FULL_BODY_BYTES,
          variables: loaded,
          configFile: source.file,
          cwd,
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
  onAdded: OnAdded = () => {},
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
            const checked = await localChecked(options.config, now.timeouts, options.overrides);
            onAdded(LOCAL_ENVIRONMENT, addedNames(options.config, checked));
            return runChecks(
              checked,
              [],
              {
                timeoutMs: now.settings.timeoutMs,
                signal,
                detail: true,
                bodyBytes: RESPONSE_FULL_BODY_BYTES,
                variables: await variables?.(),
                cwd: options.cwd,
                selection: now.selection,
              },
              now.skipped,
            );
          },
        },
      ];
  return [
    ...local,
    ...environments.map((source) => sourceCheck(source, live, onLoaded, options.cwd, onAdded)),
  ];
}

/** The local services as checked: the timeouts of the screen, then the values of local.yml. */
async function localChecked(
  config: Config,
  timeouts: Readonly<Record<string, number | undefined>>,
  overrides: NativeDashboardOptions["overrides"],
): Promise<Config> {
  const services = Object.fromEntries(
    Object.entries(config.services).map(([name, service]) => [
      name,
      { ...service, timeout: timeouts[name] },
    ]),
  );
  return withOverrides({ ...config, services }, await overrides?.());
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
  view.news = options.whatsNew?.again;
  if (options.whatsNew?.show) view.modals.push(whatsNewModal(options.whatsNew.show));
  const editing = liveEditing(options.config, options);
  view.canAdd = editing.writeService !== undefined;
  view.canCreateEnvironment = options.onEnvironmentCreate !== undefined;
  view.canEditParameters = editing.writeParameter !== undefined;
  // The writes and the undos replace the config: a pass reads it as it is when it starts.
  const live: NativeDashboardOptions = {
    ...options,
    get config() {
      return editing.config();
    },
  };
  const loaded = new Map<string, Config>();
  // The services local.yml adds: their rows stay, though no file the dashboard writes has them.
  const added = new Map<string, ReadonlySet<string>>();
  const onAdded: OnAdded = (env, names) => added.set(env, names);
  const kept = (env: string, declared: Config) =>
    new Set([...Object.keys(declared.services), ...(added.get(env) ?? [])]);
  // Parameters an environment's file declares join the local ones.
  const merge = () => mergedParameters(editing.config(), loaded.values());
  const checks = environmentChecks(
    live,
    () => view,
    (env, declared) => {
      loaded.set(env, declared);
      editing.observe?.(env, declared);
      view.choices = merge();
    },
    onAdded,
  );
  const tracker = new Tracker(checks.map((check) => check.name));
  const sources = new Map(options.environments.map((source) => [source.name, source]));
  const graceMs = NOTIFY_GRACE_SECONDS * 1000;
  // What open and copy reach: the addresses of this machine, as the checks do.
  const configOf = async (env: string): Promise<Config | undefined> => {
    if (env === LOCAL_ENVIRONMENT)
      return localChecked(editing.config(), view.timeouts, options.overrides);
    const loaded = await sources.get(env)?.load();
    return loaded && withOverrides(loaded.config, loaded.overrides);
  };
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
        // A pass that was under way when its environment was removed must not bring it back.
        if (!tracker.environments.includes(env)) return;
        // A pass that began before a removal still reports the service.
        const declared =
          env === LOCAL_ENVIRONMENT ? editing.config() : editing.environment?.(env)?.config();
        const current = declared
          ? results.filter(({ name }) => kept(env, declared).has(name))
          : results;
        tracker.record(env, current);
        notify.observe(env, current);
        app.requestRender();
      },
      onFailure: (env, message) => {
        if (!tracker.environments.includes(env)) return;
        tracker.recordFailure(env, message);
        app.requestRender();
      },
    });
    const run = async (env: string, work: (cfg: Config) => Promise<string>) => {
      const cfg = await configOf(env).catch((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      );
      if (typeof cfg === "string") say(view, cfg);
      else say(view, cfg ? await work(cfg) : `${env} cannot be read`);
      app.requestRender();
    };
    const showEnvironment = (source: EnvironmentSource) => {
      sources.set(source.name, source);
      tracker.add(source.name);
      monitor.add(
        sourceCheck(
          source,
          () => view,
          (env, declared) => {
            loaded.set(env, declared);
            editing.observe?.(env, declared);
            view.choices = merge();
          },
          undefined,
          onAdded,
        ),
      );
    };
    const hideEnvironment = (name: string) => {
      const shown = tracker.environments[view.tab - 1];
      sources.delete(name);
      loaded.delete(name);
      monitor.remove(name);
      tracker.remove(name);
      view.choices = merge();
      // The tab that was open is gone: `all`, which is the only view left when one environment remains.
      if (shown === name) view.tab = 0;
      else view.tab = Math.max(0, tracker.environments.indexOf(shown ?? "") + 1);
    };
    /** Puts the tabs back in step with the files: an undo restores a file, a redo deletes it again. */
    const reconcileEnvironments = async () => {
      const found = await options.onEnvironmentsList?.();
      if (!found) return;
      const names = new Set(found.map(({ name }) => name));
      for (const name of [...sources.keys()]) if (!names.has(name)) hideEnvironment(name);
      for (const source of found) if (!sources.has(source.name)) showEnvironment(source);
      app.requestRender();
    };
    const created = options.onEnvironmentCreate;
    const createEnvironment =
      created &&
      (async (name: string, from: EnvironmentOrigin) => {
        const { source, message } = await created(name, from);
        showEnvironment(source);
        view.tab = tracker.environments.indexOf(name) + 1;
        app.requestRender();
        return message;
      });
    // An environment's file is the source of truth: a removal or an undo there drops the rows of its services.
    const retainEnvironments = () => {
      for (const [env, source] of sources)
        void source.load().then(
          ({ config: declared }) => {
            loaded.set(env, declared);
            editing.observe?.(env, declared);
            tracker.retain(env, kept(env, declared));
            app.requestRender();
          },
          () => {},
        );
    };
    const edit = createEditor({
      createEnvironment,
      removeEnvironment: options.onEnvironmentRemove,
      view,
      tracker,
      editing,
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
        tracker.retain(LOCAL_ENVIRONMENT, kept(LOCAL_ENVIRONMENT, editing.config()));
        retainEnvironments();
        monitor.invalidate();
        monitor.refresh();
        void reconcileEnvironments();
        app.requestRender();
      },
    });
    const app: App = new App({
      render: (screen, area) => {
        view.frame = app.frame;
        renderDashboard(screen, area, tracker, view);
      },
      onInput: (event) => {
        const frame = handleInput(event, tracker, view, {
          quit: () => app.stop(),
          refresh: () => monitor.refresh(),
          edit,
          redraw: () => app.requestRender(),
          open: (service, env) =>
            void run(env, (cfg) => system(cfg).onOpen(service, view.selection)),
          copy: (service, env) =>
            void run(env, (cfg) =>
              system(cfg).onCopy(service, cfg.services[service]?.timeout, view.selection),
            ),
          copyResponse: (text, cut, part, formatted) =>
            void system(editing.config())
              .onCopyResponse(text, cut, part, formatted)
              .then((message) => {
                say(view, message);
                app.requestRender();
              }),
          saveTrace: (service, text) =>
            void options.onTraceSave?.(service, text).then((message) => {
              say(view, message);
              app.requestRender();
            }),
          copyLog: (text) =>
            void system(editing.config())
              .onCopyLog(text)
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
        });
        // Motion asks for a frame only when the hovered region changed; the other events always do.
        if (frame && event.kind === "mouse" && event.action === "move") app.requestRender();
      },
      onStop: () => {
        monitor.stop();
        focus.stop();
        resolve();
      },
      tickMs: TICK_MS,
      mouse: true,
      minSize: MIN_SIZE,
      ascii: !supportsUnicode(process.env),
    });
    monitor.start();
    app.start();
    void mismatchNotice(options).then((notice) => {
      if (!notice || view.status) return;
      say(view, notice);
      app.requestRender();
    });
  });
}

/** What local.yml still says of services config.yml has changed, told once as the dashboard opens. */
export async function mismatchNotice(
  options: Pick<NativeDashboardOptions, "config" | "overrides">,
): Promise<string | undefined> {
  const overrides = await options.overrides?.().catch(() => undefined);
  if (!overrides) return undefined;
  const [first, ...others] = mismatchMessages(
    overrides,
    localMismatches(options.config, overrides),
    CONFIG_FILE,
  );
  if (first === undefined) return undefined;
  return others.length === 0 ? first : `${first} (${others.length} more: probe doctor)`;
}
