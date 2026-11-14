import { defineCommand } from "citty";
import { readSkippedServices } from "../config/local";
import { formatServices } from "../ui/report";
import { openProject, stdoutTerminal } from "./shared";

export default defineCommand({
  meta: { name: "ls", description: "List services" },
  async run() {
    const { config, paths } = await openProject();
    if (Object.keys(config.services).length === 0) {
      console.log("No services yet. Add one: probe add api -p 3000");
      return;
    }
    console.log(formatServices(config, stdoutTerminal(), await readSkippedServices(paths)));
  },
});
