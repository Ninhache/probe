import { defineCommand } from "citty";
import { formatServices } from "../ui/report";
import { openProject, stdoutColors } from "./shared";

export default defineCommand({
  meta: { name: "ls", description: "List services" },
  async run() {
    const { config } = await openProject();
    if (Object.keys(config.services).length === 0) {
      console.log("No services yet. Add one: probe add api -p 3000");
      return;
    }
    console.log(formatServices(config, stdoutColors()));
  },
});
