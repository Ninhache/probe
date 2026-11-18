import type { CheckResult } from "../checkers/types";

/** What `r` says for a service that is not checked over HTTP. */
export const HTTP_ONLY = "The response view is HTTP-only";
export const NO_RESPONSE = "No response to show yet";

// `fetch` does not say which version of the protocol answered.
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

/** Why the response cannot be shown, or nothing when it can. */
export function responseProblem(result: CheckResult | undefined): string | undefined {
  if (!result) return NO_RESPONSE;
  if (result.type !== "http") return HTTP_ONLY;
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
