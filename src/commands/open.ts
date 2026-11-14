import { defineCommand } from "citty";
import { targetUrl } from "../checkers/http";
import { EXIT_DOWN } from "../constants";
import { openerCommand, openUrl } from "../open-url";
import { namedService, openProject } from "./shared";

export default defineCommand({
  meta: { name: "open", description: "Open the URL of a service in the browser" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
  },
  async run({ args }) {
    const { config } = await openProject();
    const url = targetUrl(namedService(config, args.name));
    if (await openUrl(url)) {
      console.log(`Opened ${url}`);
      return;
    }
    // The URL alone on stdout, so it can still be copied or piped.
    console.log(url);
    console.error(`probe: ${openerCommand(process.platform)} not found, open the URL yourself.`);
    process.exitCode = EXIT_DOWN;
  },
});
