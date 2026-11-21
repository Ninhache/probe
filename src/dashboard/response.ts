import { keepsResponse } from "../checkers/registry";
import type { CheckResult } from "../checkers/types";

/** What `r` says for a service whose type keeps no response. */
export const HTTP_ONLY = "The response view is HTTP-only";
export const NO_RESPONSE = "No response to show yet";

// `fetch` does not say which version of the protocol answered.
/** What a copy takes of the last response. */
export type ResponsePart = "response" | "body";

const HTTP_VERSION = "HTTP/1.1";
export const BODY_CUT = "body cut: the rest is not kept";

/** The status line, the headers and the body, as `curl -i` prints them. */
export function responseText(result: CheckResult): string | undefined {
  const { response, status } = result;
  if (!response || status === undefined) return undefined;
  const head = [
    `${HTTP_VERSION} ${status} ${response.statusText}`.trimEnd(),
    ...response.headers.map(([name, value]) => `${name}: ${value}`),
  ];
  return `${head.join("\r\n")}\r\n\r\n${response.body ?? ""}`;
}

/** The query parameters whose value is hidden in a saved request line, by name, as headers are. */
const SECRET_PARAMETER = /auth|cookie|token|secret|key|session|password|credential|signature/i;
const HIDDEN_PARAMETER = "***";

/** The address of the request with what a secret would sit in hidden: userinfo and sensitive parameters. */
function maskedTarget(target: string): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    // Unreadable: nothing after the path is kept rather than risk a leak.
    return target.split(/[?#]/, 1)[0] ?? "";
  }
  if (url.password) url.password = HIDDEN_PARAMETER;
  for (const [name] of [...url.searchParams])
    if (SECRET_PARAMETER.test(name)) url.searchParams.set(name, HIDDEN_PARAMETER);
  return url.href;
}

/**
 * The exchange as an `.http` file: the request line and headers as the config writes them (secrets
 * hidden), a blank line, then the response the copy takes. Nothing here is resolved from a variable.
 */
export function traceText(result: CheckResult): string | undefined {
  const answer = responseText(result);
  if (answer === undefined) return undefined;
  const line = `${result.method ?? "GET"} ${maskedTarget(result.target)} ${HTTP_VERSION}`;
  return `${[line, ...(result.sent ?? [])].join("\r\n")}\r\n\r\n${answer}`;
}

/** Why the response cannot be shown, or nothing when it can. */
export function responseProblem(result: CheckResult | undefined): string | undefined {
  if (!result) return NO_RESPONSE;
  if (!keepsResponse(result.type)) return HTTP_ONLY;
  return responseText(result) === undefined ? NO_RESPONSE : undefined;
}

export interface ResponseLines {
  head: string[];
  body: string[];
  /** Said after the body when it is not all there. */
  note?: string;
}

/** The lines the response view scrolls: the head, then the body, whole. */
export function responseLines(result: CheckResult): ResponseLines {
  const { response, status } = result;
  if (!response || status === undefined) return { head: [], body: [] };
  const note = response.bodyNote ?? (response.bodyCut ? BODY_CUT : "");
  return {
    head: [
      `${HTTP_VERSION} ${status} ${response.statusText}`.trimEnd(),
      ...response.headers.map(([name, value]) => `${name}: ${value}`),
    ],
    body: response.body === undefined ? [] : response.body.split("\n"),
    ...(note ? { note } : {}),
  };
}
