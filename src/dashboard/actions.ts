import { serviceType } from "../checkers/registry";
import type { ServiceTypes } from "../checkers/types";
import { clipboardTools, copyText } from "../clipboard";
import type { Selection } from "../config/parameters";
import type { Config } from "../config/schema";
import { notifierName, sendNotification } from "../notify";
import { openerCommand, openUrl } from "../open-url";
import type { DashboardProps } from "./Dashboard";

const NOTIFICATION_TITLE = "probe";

export interface ActionDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  openUrl: (url: string) => Promise<boolean>;
  copyText: (text: string) => Promise<boolean>;
  notify: (title: string, text: string) => Promise<boolean>;
  types?: ServiceTypes;
}

const system = (): ActionDeps => ({
  platform: process.platform,
  env: process.env,
  openUrl,
  copyText,
  notify: sendNotification,
});

export function serviceActions(
  config: (selection?: Selection) => Config,
  deps: ActionDeps = system(),
): Required<Pick<DashboardProps, "onOpen" | "onCopy" | "onNotify">> {
  const service = (name: string, selection?: Selection) => config(selection).services[name];
  const gone = (name: string) => `${name} is no longer in the config`;
  return {
    async onOpen(name, selection) {
      const found = service(name, selection);
      if (!found) return gone(name);
      const { open } = (deps.types ?? serviceType)(found);
      if (!open) return `${name} has no address to open`;
      const url = open(found);
      if (await deps.openUrl(url)) return `Opened ${url}`;
      return `${openerCommand(deps.platform)} not found. The URL:\n${url}`;
    },
    async onCopy(name, timeout, selection) {
      const found = service(name, selection);
      if (!found) return gone(name);
      const { copy } = (deps.types ?? serviceType)(found);
      if (!copy) return `${name} has no command to copy`;
      const { command, note } = copy({ ...found, timeout }, deps.env);
      if (await deps.copyText(command)) {
        return note ? `Copied: ${command}\n${note}` : `Copied: ${command}`;
      }
      const tools = clipboardTools(deps.platform, deps.env).map(([tool]) => tool);
      return `No ${tools.join(" or ")} to copy with. The command:\n${command}`;
    },
    async onNotify(message) {
      if (await deps.notify(NOTIFICATION_TITLE, message)) return undefined;
      return `${notifierName(deps.platform)} could not show a desktop notification`;
    },
  };
}
