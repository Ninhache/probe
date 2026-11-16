import { selectServices } from "../checkers/select";
import { type ProbePaths, requireProbeDir } from "../config/discovery";
import { environmentPaths } from "../config/environments";
import { serviceVariables } from "../config/headers";
import { type LoadedConfig, loadConfig, saveConfig } from "../config/loader";
import type { Variables } from "../config/local";
import type { RawConfig } from "../config/migrations";
import { type Config, SERVICE_NAME_PATTERN, type Service } from "../config/schema";
import { CONFIG_FILE, ENVIRONMENTS_DIR, MAX_TIMEOUT_SECONDS, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { blockState, syncMakefile } from "../makefile/sync";
import { type Colors, createColors } from "../ui/colors";
import { detectTerminal, type Terminal } from "../ui/terminal";

export const ENVIRONMENT_ARG = {
  type: "string",
  valueHint: "name",
  description: `Read .probe/${ENVIRONMENTS_DIR}/<name>.yml instead of the local services`,
} as const;

const TAG_OPTION = "--tag";

export const TAG_ARG = {
  type: "string",
  valueHint: "a,b",
  description: "Only the services that carry one of these tags, e.g. --tag back,infra",
} as const;

/** Every `--tag` of the command line: the argument parser keeps the last one only. */
export function tagsFrom(rawArgs: readonly string[]): string[] {
  const values: string[] = [];
  for (const [index, arg] of rawArgs.entries()) {
    if (arg === "--") break;
    if (arg === TAG_OPTION) values.push(rawArgs[index + 1] ?? "");
    else if (arg.startsWith(`${TAG_OPTION}=`)) values.push(arg.slice(TAG_OPTION.length + 1));
  }
  const tags = values.flatMap((value) => value.split(",").map((tag) => tag.trim()));
  if (tags.some((tag) => !SERVICE_NAME_PATTERN.test(tag))) {
    throw new ProbeError(
      "USAGE",
      `${TAG_OPTION} expects tags made of letters, digits, _ and -, e.g. ${TAG_OPTION} back,infra.`,
    );
  }
  return [...new Set(tags)];
}

export function configFile(paths: ProbePaths): string | undefined {
  return paths.environment === undefined
    ? undefined
    : `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${paths.environment}.yml`;
}

export function noServices(paths: ProbePaths): string {
  const file = configFile(paths);
  return file === undefined
    ? "No services yet. Add one: probe add api -p 3000"
    : `No services in ${file} yet. Write them there, as in ${PROBE_DIR}/${CONFIG_FILE}.`;
}

export async function openProject(environment?: string): Promise<LoadedConfig> {
  return loadConfig(await environmentPaths(requireProbeDir(process.cwd()), environment));
}

export function stdoutTerminal(): Terminal {
  return detectTerminal(process.stdout, process.env);
}

export function stdoutColors(): Colors {
  return createColors(stdoutTerminal().color);
}

export function secondsToMs(option: string, value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMEOUT_SECONDS) {
    throw new ProbeError(
      "USAGE",
      `${option} expects seconds between 0 and ${MAX_TIMEOUT_SECONDS}, got "${value}".`,
    );
  }
  return Math.ceil(seconds * 1000);
}

export function namedService(config: Config, name: string): Service {
  const service = Object.hasOwn(config.services, name) ? config.services[name] : undefined;
  if (!service) throw new ProbeError("SERVICE_UNKNOWN", `unknown service "${name}". See: probe ls`);
  return service;
}

// No amount of waiting brings up a service whose variable nothing sets.
export function requireVariables(
  config: Config,
  names: string[],
  variables: Variables,
  skipped: ReadonlySet<string>,
  tags: readonly string[] = [],
): void {
  for (const { name, skipped: skip } of selectServices(config, names, tags, skipped)) {
    if (skip) continue;
    const [unset] = serviceVariables(config.services[name]?.headers).filter(
      (v) => !variables.lookup(v),
    );
    if (unset === undefined) continue;
    const scope = variables.environment === undefined ? "" : ` --env ${variables.environment}`;
    throw new ProbeError(
      "VARIABLE_UNSET",
      `${name} sends ${unset}, which is not set. Set it for this machine: probe var ${unset}${scope} (or export it).`,
    );
  }
}

export function rawServices(loaded: LoadedConfig): Record<string, RawConfig> {
  return (loaded.raw.services ?? {}) as Record<string, RawConfig>;
}

// No block (the Makefile is opt-in) or a block edited by hand is left as is.
export async function saveServices(
  loaded: LoadedConfig,
  services: Record<string, RawConfig>,
): Promise<void> {
  const { warning } = await writeServices(loaded, services);
  if (warning) console.error(`probe: ${warning}`);
}

export async function writeServices(
  loaded: LoadedConfig,
  services: Record<string, RawConfig>,
): Promise<{ saved: LoadedConfig; warning?: string }> {
  const block = await blockState(loaded.paths, loaded.config);
  const saved = await saveConfig(loaded, { ...loaded.raw, services });
  if (block === "missing") return { saved };
  if (block !== "modified") {
    await syncMakefile(saved.paths, saved.config);
    return { saved };
  }
  return {
    saved,
    warning:
      "the Makefile block was edited by hand, left as is. Run `probe sync` to regenerate it.",
  };
}
