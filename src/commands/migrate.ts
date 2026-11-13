import { defineCommand } from "citty";
import { requireProbeDir } from "../config/discovery";
import { loadConfig, pendingMigration } from "../config/loader";
import { CURRENT_SCHEMA_VERSION } from "../config/schema";

export default defineCommand({
  meta: { name: "migrate", description: "Migrate the config to the current schema version" },
  async run() {
    const paths = requireProbeDir(process.cwd());
    if (!(await pendingMigration(paths))) {
      console.log(`Config is already at schema v${CURRENT_SCHEMA_VERSION}. Nothing to do.`);
      return;
    }
    // Loading migrates and prints what it did.
    await loadConfig(paths);
  },
});
