import { requireProbeDir } from "../config/discovery";
import { type LoadedConfig, loadConfig, saveConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
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
  const block = await blockState(loaded.paths, loaded.config);
  const saved = await saveConfig(loaded, { ...loaded.raw, services });
  if (block === "missing") return;
  if (block !== "modified") {
    await syncMakefile(saved.paths, saved.config);
    return;
  }
  console.error(
    "probe: the Makefile block was edited by hand, left as is. Run `probe sync` to regenerate it.",
  );
}
