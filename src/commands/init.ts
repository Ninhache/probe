import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import { pathsFor } from "../config/discovery";
import { loadConfig } from "../config/loader";
import { CURRENT_SCHEMA_VERSION } from "../config/schema";
import { BACKUP_GLOB, LOCAL_FILE, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { syncMakefile } from "../makefile/sync";

const IGNORED = [`${PROBE_DIR}/${LOCAL_FILE}`, `${PROBE_DIR}/${BACKUP_GLOB}`];

const INITIAL_CONFIG = `# probe - local services to health-check. Edit by hand or with \`probe add\`.
schemaVersion: ${CURRENT_SCHEMA_VERSION}
services: {}
`;

async function ignoreLocalFiles(root: string): Promise<void> {
  const file = join(root, ".gitignore");
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  const lines = current.split("\n").map((line) => line.trim());
  const missing = IGNORED.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await writeFile(file, `${current}${separator}${missing.join("\n")}\n`);
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Create .probe/, the .gitignore entries and the Makefile block",
  },
  async run() {
    const paths = pathsFor(process.cwd());
    if (existsSync(paths.dir)) {
      throw new ProbeError("ALREADY_INITIALIZED", `${PROBE_DIR}/ already exists here.`);
    }
    await mkdir(paths.dir);
    await writeFile(paths.config, INITIAL_CONFIG);
    await ignoreLocalFiles(paths.root);
    const { config } = await loadConfig(paths);
    await syncMakefile(paths, config);
    console.log(`Created ${PROBE_DIR}/ and the Makefile block. Next: probe add api -p 3000`);
  },
});
