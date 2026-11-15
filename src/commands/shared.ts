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

/** Reads a duration option given in seconds; throws a usage error when it is not a usable delay. */
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

/** Returns the service of that name; throws the error every command gives for an unknown one. */
export function namedService(config: Config, name: string): Service {
  const service = Object.hasOwn(config.services, name) ? config.services[name] : undefined;
  if (!service) throw new ProbeError("SERVICE_UNKNOWN", `unknown service "${name}". See: probe ls`);
  return service;
}

/**
 * Throws when a service about to be waited for sends a variable nothing sets: no amount of
 * waiting brings it up. `names` empty means every service that is not skipped.
 */
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

/**
 * Writes the new service list, then regenerates the Makefile block when the project has one.
 * No block (the Makefile is opt-in, through `probe sync`) or a block edited by hand is left as is.
 */
export async function saveServices(
  loaded: LoadedConfig,
  services: Record<string, RawConfig>,
): Promise<void> {
  const { warning } = await writeServices(loaded, services);
  if (warning) console.error(`probe: ${warning}`);
}

/** `saveServices` for a caller that owns the screen: what there is to say is returned, not printed. */
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
