import { defineCommand } from "citty";
import { requireProbeDir } from "../config/discovery";
import { loadConfig, pendingMigration } from "../config/loader";
import { type BlockState, blockState } from "../makefile/sync";
import { isOnPath } from "../platform/on-path";
import type { Colors } from "../ui/colors";
import { type Glyphs, UNICODE_GLYPHS } from "../ui/glyphs";
import { cacheDir, readCache, updateCheckDisabled, updateNotice } from "../update/notifier";
import { CLI_VERSION } from "../version";
import { stdoutColors, stdoutGlyphs } from "./shared";

export function describeBlock(
  state: BlockState,
  colors: Colors,
  glyphs: Glyphs = UNICODE_GLYPHS,
  hasMake = true,
): string {
  // Without make the block cannot be run, so its state asks nothing of anyone: `probe check` does the same.
  if (!hasMake) return colors.dim("make not installed: `probe check` does the same");
  switch (state) {
    case "in-sync":
      return colors.green("in sync");
    case "modified":
      return colors.yellow(`block edited by hand ${glyphs.arrow} run \`probe sync\` to restore it`);
    case "outdated":
      return colors.yellow(`out of date ${glyphs.arrow} run \`probe sync\``);
    case "missing":
      return colors.dim(`no probe block (optional) ${glyphs.arrow} \`probe sync\` adds one`);
  }
}

export function describeUpdate(colors: Colors, glyphs: Glyphs = UNICODE_GLYPHS): string {
  if (updateCheckDisabled()) return colors.dim(`check disabled (${CLI_VERSION})`);
  const notice = updateNotice(CLI_VERSION, cacheDir(), glyphs);
  if (notice) return colors.yellow(notice);
  if (!readCache(cacheDir())?.latest) return colors.dim(`not checked yet (${CLI_VERSION})`);
  return colors.green(`up to date (${CLI_VERSION})`);
}

export default defineCommand({
  meta: { name: "status", description: "Show pending migration, Makefile state and updates" },
  async run() {
    const colors = stdoutColors();
    const glyphs = stdoutGlyphs();
    const paths = requireProbeDir(process.cwd());
    const pending = await pendingMigration(paths);
    const line = (label: string, value: string) => console.log(`${label.padEnd(10)} ${value}`);

    if (pending) {
      const change = `schema v${pending.from} ${glyphs.arrow} v${pending.to}`;
      line("migration", colors.yellow(`pending (${change}) ${glyphs.arrow} run \`probe migrate\``));
      line("makefile", colors.dim("checked after the migration"));
    } else {
      const { config } = await loadConfig(paths);
      line("migration", colors.green("none pending"));
      line(
        "makefile",
        describeBlock(await blockState(paths, config), colors, glyphs, await isOnPath("make")),
      );
    }
    line("update", describeUpdate(colors, glyphs));
  },
});
