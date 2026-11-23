import { runChecks } from "../../checkers/run";
import type { CheckResult } from "../../checkers/types";
import type { Variables } from "../../config/local";
import { withOverrides } from "../../config/overrides";
import type { Selection } from "../../config/parameters";
import type { Config } from "../../config/schema";
import { createColors } from "../../ui/colors";
import type { Glyphs } from "../../ui/glyphs";
import { formatCheckResults } from "../../ui/report";
import type { Terminal } from "../../ui/terminal";
import type { EnvironmentSource } from "../sources";
import { LOCAL_ENVIRONMENT } from "./history";

export interface OncePass {
  config: Config;
  variables: Variables;
  skipped: ReadonlySet<string>;
  selection: Selection;
  timeoutMs: number;
  /** The project root, where the command services run. */
  cwd?: string;
  environments: readonly EnvironmentSource[];
  terminal: Terminal;
  glyphs?: Glyphs;
  /** Said when there is nothing to check. */
  empty: string;
  run?: typeof runChecks;
}

/** One pass over the local config and every environment, as plain text; `down` when a service is. */
export async function oncePass(pass: OncePass): Promise<{ text: string; down: boolean }> {
  const run = pass.run ?? runChecks;
  const colors = createColors(pass.terminal.color);
  const options = { timeoutMs: pass.timeoutMs, selection: pass.selection, cwd: pass.cwd };
  const sections: { name: string; results: CheckResult[] }[] = [
    {
      name: LOCAL_ENVIRONMENT,
      results: await run(pass.config, [], { ...options, variables: pass.variables }, pass.skipped),
    },
  ];
  for (const source of pass.environments) {
    const loaded = await source.load();
    sections.push({
      name: source.name,
      results: await run(
        withOverrides(loaded.config, loaded.overrides),
        [],
        { ...options, variables: loaded.variables, configFile: source.file },
        loaded.skipped,
      ),
    });
  }
  const shown = sections.filter(({ results }) => results.length > 0);
  const down = shown.some(({ results }) => results.some((result) => !result.ok));
  if (shown.length === 0) return { text: pass.empty, down };
  const several = pass.environments.length > 0;
  const text = shown
    .map(({ name, results }) => {
      const table = formatCheckResults(results, pass.terminal, pass.glyphs);
      return several ? `${colors.bold(name)}\n${table}` : table;
    })
    .join("\n\n");
  return { text, down };
}
