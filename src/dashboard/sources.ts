import type { ProbePaths } from "../config/discovery";
import { environmentPaths } from "../config/environments";
import { loadConfig } from "../config/loader";
import {
  loadVariables,
  readServiceOverrides,
  readSkippedServices,
  type Variables,
} from "../config/local";
import type { ServiceOverrides } from "../config/overrides";
import type { Config } from "../config/schema";
import { ENVIRONMENTS_DIR, PROBE_DIR } from "../constants";

export interface EnvironmentSource {
  name: string;
  file: string;
  /** Read before each pass: the file is edited by hand while the dashboard runs. */
  load: () => Promise<{
    /** As the file declares it: edits start from it, checks add `overrides`. */
    config: Config;
    variables: Variables;
    skipped: ReadonlySet<string>;
    overrides: ServiceOverrides;
  }>;
}

export function environmentSource(
  paths: ProbePaths,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentSource {
  return {
    name,
    file: `${PROBE_DIR}/${ENVIRONMENTS_DIR}/${name}.yml`,
    async load() {
      const found = await environmentPaths(paths, name);
      const loaded = await loadConfig(found, { log: () => {} });
      return {
        config: loaded.config,
        variables: await loadVariables(found, env),
        skipped: await readSkippedServices(found),
        overrides: await readServiceOverrides(found),
      };
    },
  };
}
