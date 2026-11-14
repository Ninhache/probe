import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import { pathsFor } from "../config/discovery";
import { CURRENT_SCHEMA_VERSION } from "../config/schema";
import { BACKUP_GLOB, LOCAL_FILE, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { isInteractive } from "../ui/terminal";
import { offerDetected } from "./detected";
import { openProject } from "./shared";

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

/**
 * Creates `.probe/` with an empty config in `root`, and ignores its per-machine files in git.
 * @throws ProbeError `ALREADY_INITIALIZED` when `root` already has a `.probe/`
 */
export async function initProject(root: string): Promise<void> {
  const paths = pathsFor(root);
  if (existsSync(paths.dir)) {
    throw new ProbeError("ALREADY_INITIALIZED", `${PROBE_DIR}/ already exists here.`);
  }
  await mkdir(paths.dir);
  await writeFile(paths.config, INITIAL_CONFIG);
  await ignoreLocalFiles(paths.root);
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Create .probe/ and the .gitignore entries",
  },
  async run() {
    await initProject(process.cwd());
    const next = "Next: probe add api -p 3000";
    // Off a terminal nobody can tick a list: nothing is looked for.
    if (!isInteractive(process.stdin, process.stdout, process.env)) {
      console.log(`Created ${PROBE_DIR}/. ${next}`);
      return;
    }
    console.log(`Created ${PROBE_DIR}/.`);
    const added = await offerDetected(await openProject());
    if (!added || added.length === 0) console.log(next);
  },
});
