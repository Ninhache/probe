import { requireProbeDir } from "../config/discovery";
import { type LoadedConfig, loadConfig, saveConfig } from "../config/loader";
import type { RawConfig } from "../config/migrations";
import { blockState, syncMakefile } from "../makefile/sync";
import { type Colors, colorEnabled, createColors } from "../ui/colors";

export function openProject(): Promise<LoadedConfig> {
  return loadConfig(requireProbeDir(process.cwd()));
}

export function stdoutColors(): Colors {
  return createColors(colorEnabled(process.stdout, process.env));
}

export function rawServices(loaded: LoadedConfig): Record<string, RawConfig> {
  return (loaded.raw.services ?? {}) as Record<string, RawConfig>;
}

/** Writes the new service list, then regenerates the Makefile block, unless it was edited by hand. */
export async function saveServices(
  loaded: LoadedConfig,
  services: Record<string, RawConfig>,
): Promise<void> {
  const edited = (await blockState(loaded.paths, loaded.config)) === "modified";
  const saved = await saveConfig(loaded, { ...loaded.raw, services });
  if (!edited) {
    await syncMakefile(saved.paths, saved.config);
    return;
  }
  console.error(
    "probe: the Makefile block was edited by hand, left as is. Run `probe sync` to regenerate it.",
  );
}
