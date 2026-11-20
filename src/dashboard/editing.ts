import { defaultType, getServiceType, serviceType, serviceTypeNames } from "../checkers/registry";
import type { ServiceForm } from "../checkers/types";
import type { ParameterProblem, ParameterWrite } from "../commands/parameter-writes";
import type { ServiceFields, ServiceWrite } from "../commands/service-writes";
import { serviceVariables } from "../config/headers";
import { type Config, declaresAddress, type Parameter, type Service } from "../config/schema";
import type { UrlParameter } from "./form";
import type { Addresses } from "./parameter-form";
import type { Saved } from "./saves";
import { type VariableSources, type VariableTools, variableTools } from "./variables";

/** The values of the variables a write keeps in local.yml, by name. */
export type Secrets = Readonly<Record<string, string>>;

export interface ServiceWriteOutcome {
  saved: boolean;
  failure?: string;
  warning?: string;
}

export interface ParameterWriteOutcome {
  saved: boolean;
  problem?: ParameterProblem;
  failure?: string;
  drops?: string[];
}

export type ServiceTimeouts = Readonly<Record<string, number | undefined>>;

/** What writes the files, given by the command line: each resolves to the config as written, or to why not. */
export interface EditCallbacks {
  onServiceWrite?: (
    write: ServiceWrite,
    secrets?: Secrets,
  ) => Promise<{ config?: Config; failure?: string; warning?: string }>;
  onParameterWrite?: (write: ParameterWrite) => Promise<{
    config?: Config;
    problem?: ParameterProblem;
    failure?: string;
    drops?: string[];
  }>;
  /** Puts back the config as it was before the last write: `config` once it is done. */
  onUndo?: () => Promise<{ config?: Config; undone?: string; failure?: string }>;
  /** Writes again what the last undo took back. */
  onRedo?: () => Promise<{ config?: Config; undone?: string; failure?: string }>;
  variableSources?: VariableSources;
  /** `env` keeps the value under that environment in local.yml: none is the top level. */
  onVariableWrite?: (name: string, value: string, env?: string) => Saved;
  /** Removes the value `env` keeps in local.yml: none is the top level. */
  onVariableRemove?: (name: string, env?: string) => Saved;
}

const pickFields = (service: Service): ServiceFields => {
  const { url, host, port, path, expect, method, headers, command, env } = service;
  // Read from `urls:`, the address is not the service's: the form shows none, and writes none back.
  const address = declaresAddress(service) ? { url, host, port, path } : {};
  return { ...address, expect, method, headers, command, env };
};

export const timeoutsOf = ({ services }: Config): Record<string, number> =>
  Object.fromEntries(
    Object.entries(services).flatMap(([name, { timeout }]) =>
      timeout === undefined ? [] : [[name, timeout]],
    ),
  );

export interface Editing {
  /** The config as it is now: every write and undo replaces it. */
  config(): Config;
  /** Hands over an environment file as read by a pass, so its services can be edited. */
  observe?(env: string, config: Config): void;
  /** The same editing on the file of `env`; undefined while that file has not been read. */
  environment?(env: string): Editing | undefined;
  /** The form of service `name`; of the type named `type` when adding, the default one without. */
  serviceForm(name?: string, type?: string): ServiceForm;
  /** The types a new service can be of: the add form offers them as a closed list. */
  serviceTypes(): readonly string[];
  serviceFields(name: string): ServiceFields | undefined;
  parameterFields(name: string): Parameter | undefined;
  addresses(): Addresses;
  urlParameter(): UrlParameter | undefined;
  writeService?: (write: ServiceWrite, secrets?: Secrets) => Promise<ServiceWriteOutcome>;
  writeParameter?: (write: ParameterWrite) => Promise<ParameterWriteOutcome>;
  undo?: () => Promise<{ undone?: string; failure?: string; timeouts?: ServiceTimeouts }>;
  redo?: () => Promise<{ undone?: string; failure?: string; timeouts?: ServiceTimeouts }>;
  variables?: VariableTools;
  writeVariable?: (name: string, value: string) => Saved;
  removeVariable?: (name: string) => Saved;
}

const reads = (config: () => Config) => ({
  serviceTypes: serviceTypeNames,
  serviceForm(name?: string, type?: string): ServiceForm {
    const service = name === undefined ? undefined : config().services[name];
    if (!service) return (type === undefined ? defaultType() : getServiceType(type)).form;
    const { form } = serviceType(service);
    return form.forService?.(service) ?? form;
  },
  serviceFields(name: string): ServiceFields | undefined {
    const service = config().services[name];
    return service && pickFields(service);
  },
  parameterFields: (name: string) => config().parameters?.[name],
  addresses: (): Addresses =>
    Object.fromEntries(
      Object.entries(config().services).map(([name, service]) => [name, { ...service.urls }]),
    ),
  urlParameter(): UrlParameter | undefined {
    const found = Object.entries(config().parameters ?? {}).find(
      ([, { strategy }]) => strategy.kind === "url",
    );
    return found && { name: found[0], values: found[1].values };
  },
});

const writeIn =
  (write: NonNullable<EditCallbacks["onVariableWrite"]>, env: string) =>
  (name: string, value: string) =>
    write(name, value, env);

const removeIn =
  (remove: NonNullable<EditCallbacks["onVariableRemove"]>, env: string) => (name: string) =>
    remove(name, env);

/** The config the dashboard edits, kept in step with what the writes and undos leave. */
export function liveEditing(initial: Config, edits: EditCallbacks = {}): Editing {
  let config = initial;
  const environments = new Map<string, Config>();
  const revert = async (way: NonNullable<EditCallbacks["onUndo"]>) => {
    const { config: restored, ...outcome } = await way();
    if (restored) config = restored;
    return { ...outcome, timeouts: restored && timeoutsOf(restored) };
  };
  const variables = edits.variableSources && variableTools(() => config, edits.variableSources);
  const { onServiceWrite, onParameterWrite, onUndo, onRedo } = edits;
  const unsetNote = async (current: Config, name: string, env?: string) => {
    const sent = serviceVariables(current.services[name] ?? {});
    const found = (await edits.variableSources?.(sent, env)) ?? {};
    const unset = sent.filter((variable) => !found[variable]);
    if (!edits.variableSources || unset.length === 0) return undefined;
    return `${unset.join(", ")} not set: open ${name} with enter, then enter on the variable`;
  };
  /** Writes to config.yml, or to the file of `env`: the config each leaves is kept apart. */
  const writer =
    onServiceWrite &&
    ((env: string | undefined) =>
      async (write: ServiceWrite, secrets?: Secrets): Promise<ServiceWriteOutcome> => {
        const { config: written, ...outcome } = await onServiceWrite(
          env === undefined ? write : { ...write, env },
          secrets,
        );
        if (written) {
          if (env === undefined) config = written;
          else environments.set(env, written);
        }
        const notes = [outcome.warning, written && (await unsetNote(written, write.name, env))];
        const warning = notes.filter(Boolean).join("\n") || undefined;
        return { ...outcome, warning, saved: written !== undefined };
      });
  return {
    config: () => config,
    ...reads(() => config),
    observe: (env, declared) => void environments.set(env, declared),
    environment(env) {
      if (!environments.has(env)) return undefined;
      const read = () => environments.get(env) as Config;
      const sources = edits.variableSources;
      return {
        config: read,
        ...reads(read),
        writeService: writer?.(env),
        variables: sources && variableTools(read, (names) => sources(names, env)),
        writeVariable: edits.onVariableWrite && writeIn(edits.onVariableWrite, env),
        removeVariable: edits.onVariableRemove && removeIn(edits.onVariableRemove, env),
      };
    },
    writeService: writer?.(undefined),
    writeParameter:
      onParameterWrite &&
      (async (write) => {
        const { config: written, ...outcome } = await onParameterWrite(write);
        if (written) config = written;
        return { ...outcome, saved: written !== undefined };
      }),
    undo: onUndo && (() => revert(onUndo)),
    redo: onRedo && (() => revert(onRedo)),
    variables,
    writeVariable: edits.onVariableWrite,
    removeVariable: edits.onVariableRemove && ((name) => edits.onVariableRemove?.(name) as Saved),
  };
}
