import { defineCommand } from "citty";
import { serviceType } from "../checkers/registry";
import { localConfig } from "../config/local";
import { applySelection } from "../config/parameters";
import { EXIT_DOWN } from "../constants";
import { ProbeError } from "../errors";
import { openUrl } from "../open-url";
import { currentPlatform } from "../platform";
import { namedService, openProject, SET_ARG, selectionFrom } from "./shared";

export default defineCommand({
  meta: { name: "open", description: "Open a service in the browser" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
    set: SET_ARG,
  },
  async run({ args, rawArgs }) {
    const loaded = await openProject();
    const config = await localConfig(loaded.config, loaded.paths);
    const service = namedService(applySelection(config, selectionFrom(config, rawArgs)), args.name);
    const { open } = serviceType(service);
    if (!open) throw new ProbeError("USAGE", `${args.name} has no address to open.`);
    const url = open(service);
    if (await openUrl(url)) {
      console.log(`Opened ${url}`);
      return;
    }
    // The URL alone on stdout, so it can still be copied or piped.
    console.log(url);
    console.error(
      `probe: ${currentPlatform.openUrlCommand(url).command} not found, open the URL yourself.`,
    );
    process.exitCode = EXIT_DOWN;
  },
});
