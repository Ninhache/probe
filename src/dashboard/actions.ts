import { serviceType } from "../checkers/registry";
import type { ServiceTypes } from "../checkers/types";
import { copyText } from "../clipboard";
import type { Selection } from "../config/parameters";
import type { Config } from "../config/schema";
import { sendNotification } from "../notify";
import { openUrl } from "../open-url";
import { currentPlatform, type Platform } from "../platform";
import type { ResponsePart } from "./response";

const NOTIFICATION_TITLE = "probe";

export interface ActionDeps {
  platform: Platform;
  env: NodeJS.ProcessEnv;
  openUrl: (url: string) => Promise<boolean>;
  copyText: (text: string) => Promise<boolean>;
  notify: (title: string, text: string) => Promise<boolean>;
  types?: ServiceTypes;
}

const system = (): ActionDeps => ({
  platform: currentPlatform,
  env: process.env,
  openUrl,
  copyText,
  notify: sendNotification,
});

export function serviceActions(
  config: (selection?: Selection) => Config,
  deps: ActionDeps = system(),
): {
  onOpen(name: string, selection?: Selection): Promise<string>;
  onCopy(name: string, timeout: number | undefined, selection?: Selection): Promise<string>;
  /** Resolves to a warning when no notification could be shown. */
  onNotify(message: string): Promise<string | undefined>;
  onCopyResponse(
    text: string,
    cut: boolean,
    part?: ResponsePart,
    formatted?: boolean,
  ): Promise<string>;
  onCopyLog(text: string): Promise<string>;
} {
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
      return `${deps.platform.openUrlCommand(url).command} not found. The URL:\n${url}`;
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
      const tools = deps.platform.clipboardTools(deps.env).map(([tool]) => tool);
      return `No ${tools.join(" or ")} to copy with. The command:\n${command}`;
    },
    async onCopyResponse(text, cut, part = "response", formatted = false) {
      if (await deps.copyText(text)) {
        if (formatted) return `Copied the ${part} (formatted JSON)`;
        return cut ? `Copied the ${part}, its body cut` : `Copied the ${part}`;
      }
      const tools = deps.platform.clipboardTools(deps.env).map(([tool]) => tool);
      return `No ${tools.join(" or ")} to copy the ${part} with`;
    },
    async onCopyLog(text) {
      if (await deps.copyText(text)) return "Copied the log lines";
      const tools = deps.platform.clipboardTools(deps.env).map(([tool]) => tool);
      return `No ${tools.join(" or ")} to copy the log with`;
    },
    async onNotify(message) {
      if (await deps.notify(NOTIFICATION_TITLE, message)) return undefined;
      return `${deps.platform.notifier.name} could not show a desktop notification`;
    },
  };
}
