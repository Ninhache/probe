import { defineCommand } from "citty";
import { requireProbeDir } from "../config/discovery";
import { loadConfig, pendingMigration } from "../config/loader";
import { type BlockState, blockState } from "../makefile/sync";
import type { Colors } from "../ui/colors";
import { cacheDir, readCache, updateCheckDisabled, updateNotice } from "../update/notifier";
import { CLI_VERSION } from "../version";
import { stdoutColors } from "./shared";

function describeBlock(state: BlockState, colors: Colors): string {
  switch (state) {
    case "in-sync":
      return colors.green("in sync");
    case "modified":
      return colors.yellow("block edited by hand → run `probe sync` to restore it");
    case "outdated":
      return colors.yellow("out of date → run `probe sync`");
    case "missing":
      return colors.dim("no probe block (optional) → `probe sync` adds one");
  }
}

function describeUpdate(colors: Colors): string {
  if (updateCheckDisabled()) return colors.dim(`check disabled (${CLI_VERSION})`);
  const notice = updateNotice(CLI_VERSION, cacheDir());
  if (notice) return colors.yellow(notice);
  if (!readCache(cacheDir())?.latest) return colors.dim(`not checked yet (${CLI_VERSION})`);
  return colors.green(`up to date (${CLI_VERSION})`);
}

export default defineCommand({
  meta: { name: "status", description: "Show pending migration, Makefile state and updates" },
  async run() {
    const colors = stdoutColors();
    const paths = requireProbeDir(process.cwd());
    const pending = await pendingMigration(paths);
    const line = (label: string, value: string) => console.log(`${label.padEnd(10)} ${value}`);

    if (pending) {
      const change = `schema v${pending.from} → v${pending.to}`;
      line("migration", colors.yellow(`pending (${change}) → run \`probe migrate\``));
      line("makefile", colors.dim("checked after the migration"));
    } else {
      const { config } = await loadConfig(paths);
      line("migration", colors.green("none pending"));
      line("makefile", describeBlock(await blockState(paths, config), colors));
    }
    line("update", describeUpdate(colors));
  },
});
