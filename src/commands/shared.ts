import { requireProbeDir } from "../config/discovery";
import { serviceVariables } from "../config/headers";
import { type LoadedConfig, loadConfig, saveConfig } from "../config/loader";
import type { Variables } from "../config/local";
import type { RawConfig } from "../config/migrations";
import type { Config, Service } from "../config/schema";
import { MAX_TIMEOUT_SECONDS } from "../constants";
import { ProbeError } from "../errors";
import { blockState, syncMakefile } from "../makefile/sync";
import { type Colors, createColors } from "../ui/colors";
import { detectTerminal, type Terminal } from "../ui/terminal";

export function openProject(): Promise<LoadedConfig> {
  return loadConfig(requireProbeDir(process.cwd()));
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
): void {
  const selected =
    names.length > 0 ? names : Object.keys(config.services).filter((name) => !skipped.has(name));
  for (const name of selected) {
    const service = Object.hasOwn(config.services, name) ? config.services[name] : undefined;
    const [unset] = serviceVariables(service?.headers).filter((v) => !variables.lookup(v));
    if (unset === undefined) continue;
    throw new ProbeError(
      "VARIABLE_UNSET",
      `${name} sends ${unset}, which is not set. Set it for this machine: probe var ${unset} (or export it).`,
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
