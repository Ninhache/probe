import { curlCommand, targetUrl } from "../checkers/http";
import { clipboardTools, copyText } from "../clipboard";
import type { Config } from "../config/schema";
import { openerCommand, openUrl } from "../open-url";
import type { DashboardProps } from "./Dashboard";

/** What the actions reach outside the process, so tests can replace it. */
export interface ActionDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  openUrl: (url: string) => Promise<boolean>;
  copyText: (text: string) => Promise<boolean>;
}

const system = (): ActionDeps => ({
  platform: process.platform,
  env: process.env,
  openUrl,
  copyText,
});

/**
 * What `u` and `c` do for a service of `config`, each resolving to the lines that say what happened.
 * When the tool is missing, the URL or the command is alone on its line, to be selected by hand.
 */
export function serviceActions(
  config: Config,
  deps: ActionDeps = system(),
): Required<Pick<DashboardProps, "onOpen" | "onCopy">> {
  const service = (name: string) => config.services[name] as Config["services"][string];
  return {
    async onOpen(name) {
      const url = targetUrl(service(name));
      if (await deps.openUrl(url)) return `Opened ${url}`;
      return `${openerCommand(deps.platform)} not found. The URL:\n${url}`;
    },
    async onCopy(name, timeout) {
      const command = curlCommand({ ...service(name), timeout });
      if (await deps.copyText(command)) return `Copied: ${command}`;
      const tools = clipboardTools(deps.platform, deps.env).map(([tool]) => tool);
      return `No ${tools.join(" or ")} to copy with. The command:\n${command}`;
    },
  };
}
