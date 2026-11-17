import { targetOf } from "../checkers/registry";
import type { LoadedConfig } from "../config/loader";
import { serviceSchemaV1 } from "../config/schema";
import { detectServices, systemDeps } from "../detect";
import { choose } from "../ui/prompt";
import { rawServices, saveServices } from "./shared";

export async function offerDetected(loaded: LoadedConfig): Promise<string[] | null> {
  const services = rawServices(loaded);
  const candidates = await detectServices(loaded.paths.root, services, systemDeps(process.env));
  if (candidates.length === 0) return [];
  const urls = candidates.map(({ service }) => targetOf(serviceSchemaV1.parse(service)));
  const nameWidth = Math.max(...candidates.map(({ name }) => name.length));
  const urlWidth = Math.max(...urls.map((url) => url.length));
  // The source is part of the label: a hint shows on the line under the cursor only.
  const choices = candidates.map(({ name, source }, index) => ({
    label: `${name.padEnd(nameWidth)}  ${(urls[index] ?? "").padEnd(urlWidth)}  ${source}`,
  }));
  const picked = await choose("Services found here: which ones to add?", choices);
  if (picked === null) return null;
  const added = picked.map((index) => candidates[index]).filter((candidate) => !!candidate);
  if (added.length === 0) return [];
  const entries = Object.fromEntries(added.map(({ name, service }) => [name, service]));
  await saveServices(loaded, { ...services, ...entries });
  const names = added.map(({ name }) => name);
  console.log(`Added ${names.join(", ")}. Try: probe check`);
  return names;
}
