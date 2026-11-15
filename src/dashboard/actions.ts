import { curlCommand, targetUrl } from "../checkers/http";
import { clipboardTools, copyText } from "../clipboard";
import type { Config } from "../config/schema";
import { notifierName, sendNotification } from "../notify";
import { openerCommand, openUrl } from "../open-url";
import type { DashboardProps } from "./Dashboard";

const NOTIFICATION_TITLE = "probe";

/** What the actions reach outside the process, so tests can replace it. */
export interface ActionDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  openUrl: (url: string) => Promise<boolean>;
  copyText: (text: string) => Promise<boolean>;
  notify: (title: string, text: string) => Promise<boolean>;
}

const system = (): ActionDeps => ({
  platform: process.platform,
  env: process.env,
  openUrl,
  copyText,
  notify: sendNotification,
});

/**
 * What `u` and `c` do for a service of the config as it is when the key is pressed, each resolving to the lines that say what happened,
 * and how a change of state is notified.
 * When the tool is missing, the URL or the command is alone on its line, to be selected by hand.
 */
export function serviceActions(
  config: () => Config,
  deps: ActionDeps = system(),
): Required<Pick<DashboardProps, "onOpen" | "onCopy" | "onNotify">> {
  const service = (name: string) => config().services[name];
  const gone = (name: string) => `${name} is no longer in the config`;
  return {
    async onOpen(name) {
      const found = service(name);
      if (!found) return gone(name);
      const url = targetUrl(found);
      if (await deps.openUrl(url)) return `Opened ${url}`;
      return `${openerCommand(deps.platform)} not found. The URL:\n${url}`;
    },
    async onCopy(name, timeout) {
      const found = service(name);
      if (!found) return gone(name);
      const command = curlCommand({ ...found, timeout });
      if (await deps.copyText(command)) return `Copied: ${command}`;
      const tools = clipboardTools(deps.platform, deps.env).map(([tool]) => tool);
      return `No ${tools.join(" or ")} to copy with. The command:\n${command}`;
    },
    async onNotify(message) {
      if (await deps.notify(NOTIFICATION_TITLE, message)) return undefined;
      return `${notifierName(deps.platform)} could not show a desktop notification`;
    },
  };
}
