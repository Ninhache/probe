import { relative } from "node:path";
import { defineCommand } from "citty";
import { makefilePath, syncMakefile } from "../makefile/sync";
import { openProject } from "./shared";

export default defineCommand({
  meta: { name: "sync", description: "Regenerate the probe block of the Makefile" },
  async run() {
    const { config, paths } = await openProject();
    const { created, changed } = await syncMakefile(paths, config);
    const file = relative(process.cwd(), makefilePath(paths)) || "Makefile";
    if (created) console.log(`Created ${file}. Try: make help`);
    else if (changed) console.log(`Updated the probe block in ${file}.`);
    else console.log(`${file} is already in sync.`);
  },
});
