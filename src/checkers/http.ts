import {
  hiddenHeaderLine,
  masked,
  resolveHeaders,
  serviceVariables,
  templateParts,
} from "../config/headers";
import { DEFAULT_METHOD, type Service } from "../config/schema";
import { CONTAINS_BODY_BYTES, DEFAULT_TIMEOUT_SECONDS, MAX_REDIRECTS } from "../constants";
import {
  type BodyGap,
  type Diagnosis,
  diagnoseBody,
  diagnoseFailure,
  diagnoseForeignRedirect,
  diagnoseStatus,
  diagnoseUnsendable,
  diagnoseUnset,
  HEADERS_REFUSED,
  hasUnknownIssuer,
  TOO_MANY_REDIRECTS,
  unknownIssuerHint,
} from "./diagnosis";
import { describeResponse, type ResponseDetail } from "./response";
import { type SystemTrust, systemTrust } from "./system-ca";
import type { CheckContext, Checker, CheckResult } from "./types";

export function targetUrl(service: Service): string {
  if (service.url !== undefined) return service.url;
  const bareIpv6 = service.host.includes(":") && !service.host.startsWith("[");
  const host = bareIpv6 ? `[${service.host}]` : service.host;
  return `http://${host}:${service.port}${service.path}`;
}

const shellQuoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

// What a shell reads inside double quotes, or as a history expansion.
const SHELL_SPECIAL = /[\\"`$!]/;
const NAME_CHARACTER = /^[A-Za-z0-9_]/;

// A variable stays a reference (`$API_TOKEN`): its value is never written in a command.
function shellHeader(name: string, template: string): string {
  const line = `${name}: ${template}`;
  const parts = templateParts(line);
  if (parts.every((part) => part.variable === undefined)) return shellQuoted(line);
  if (parts.some((part) => SHELL_SPECIAL.test(part.text ?? ""))) {
    return parts
      .map(({ text, variable }) =>
        variable === undefined ? shellQuoted(text ?? "") : `"$${variable}"`,
      )
      .join("");
  }
  const word = parts.map(({ text, variable }, index) => {
    if (variable === undefined) return text;
    // Braces only where the name would run into what follows: fish does not read `${NAME}`.
    return NAME_CHARACTER.test(parts[index + 1]?.text ?? "") ? `\${${variable}}` : `$${variable}`;
  });
  return `"${word.join("")}"`;
}

// `fetch` sends `Content-Length: 0` with these, curl does not: some servers answer 411 without it.
const BODILESS = new Set(["POST", "PUT", "PATCH"]);

// Any other method is sent once: a redirect is the answer, never a second POST or DELETE.
export function followsRedirects(service: Service): boolean {
  const method = service.method ?? DEFAULT_METHOD;
  return !expectsRedirect(service.expect) && (method === "GET" || method === "HEAD");
}

// No `-L` with headers: curl would send them to whatever host a redirect names.
export function curlCommand(service: Service): string {
  const headers = Object.entries(service.headers ?? {});
  const method = service.method ?? DEFAULT_METHOD;
  const follow = !followsRedirects(service) || headers.length > 0 ? "" : " -L";
  const seconds = service.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  // `-X HEAD` would wait for a body that never comes.
  const shown = method === "HEAD" ? "-I" : "-i";
  const verb = method === "GET" || method === "HEAD" ? "" : ` -X ${method}`;
  const empty = BODILESS.has(method) ? " -H 'Content-Length: 0'" : "";
  const sent = headers.map(([name, value]) => ` -H ${shellHeader(name, value)}`).join("");
  return `curl ${shown}${follow}${verb} --max-time ${seconds}${empty}${sent} ${shellQuoted(targetUrl(service))}`;
}

function isExpected(expect: Service["expect"], status: number): boolean {
  if (expect === undefined) return status >= 200 && status < 300;
  return Array.isArray(expect) ? expect.includes(status) : expect === status;
}

function expectsRedirect(expect: Service["expect"]): boolean {
  return [expect ?? []].flat().some((status) => status >= 300 && status < 400);
}

// probe may get them from `local.yml`, a shell does not.
export function curlNote(service: Service, env: NodeJS.ProcessEnv): string | undefined {
  const absent = serviceVariables(service.headers).filter((name) => !env[name]);
  if (absent.length === 0) return undefined;
  return `it reads ${absent.join(", ")} from the shell that runs it: export ${absent.length > 1 ? "them" : "it"} there first`;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

// Redirects are followed by hand, same origin only: `fetch` would carry the headers to any host.
async function fetchWithHeaders(
  target: string,
  init: { headers: Headers; signal: AbortSignal; method: string | undefined },
  follow: boolean,
): Promise<{ response: Response; leftFor?: string } | undefined> {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    const next = location !== null && URL.canParse(location, url) ? new URL(location, url) : null;
    if (!follow || !isRedirect(response.status) || !next) return { response };
    if (next.origin !== new URL(url).origin) return { response, leftFor: next.origin };
    await response.body?.cancel();
    url = next.href;
  }
  return undefined;
}

const maskedDetail = (detail: ResponseDetail, secrets: readonly string[]): ResponseDetail => ({
  ...detail,
  statusText: masked(detail.statusText, secrets),
  headers: detail.headers.map(([name, value]) => [name, masked(value, secrets)]),
  ...(detail.body === undefined ? {} : { body: masked(detail.body, secrets) }),
});

// A read that fails or times out rejects: the check then reports that, not a missing text.
async function searchBody(
  body: ReadableStream<Uint8Array> | null,
  text: string,
): Promise<BodyGap | "found"> {
  if (!body) return "empty";
  const needle = Buffer.from(text);
  const reader = body.getReader();
  let tail: Uint8Array = new Uint8Array();
  let size = 0;
  try {
    while (size < CONTAINS_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) return size === 0 ? "empty" : "absent";
      const read = value.subarray(0, CONTAINS_BODY_BYTES - size);
      size += value.length;
      // The end of what was read is kept: the text may sit across two chunks.
      const window = Buffer.concat([tail, read]);
      if (window.includes(needle)) return "found";
      tail = window.subarray(Math.max(0, window.length - needle.length + 1));
    }
    return "cut";
  } finally {
    void reader.cancel().catch(() => {});
  }
}

async function request(
  name: string,
  service: Service,
  { timeoutMs, signal, detail, variables }: CheckContext,
): Promise<{ result: CheckResult; unknownIssuer: boolean }> {
  const target = targetUrl(service);
  const written = Object.entries(service.headers ?? {});
  // As written, never resolved: a variable stays `${NAME}`, a secret typed in clear is starred.
  const sent =
    detail && written.length > 0
      ? { sent: written.map(([header, value]) => hiddenHeaderLine(`${header}: ${value}`, "*")) }
      : {};
  const asked = detail ? { method: service.method ?? "GET" } : {};
  const base = { name, type: "http", target, ...asked, ...sent };
  const failed = (diagnosis: Diagnosis, latencyMs = 0) => ({
    result: { ...base, ok: false, latencyMs, ...diagnosis },
    unknownIssuer: false,
  });
  let headers: Headers | undefined;
  let secrets: string[] = [];
  if (service.headers) {
    const resolved = resolveHeaders(service.headers, variables?.lookup ?? (() => undefined));
    // Nothing is sent: a request without its credentials would only say 401.
    if ("unset" in resolved) {
      return failed(diagnoseUnset(resolved.unset, variables ?? {}));
    }
    if ("unsendable" in resolved)
      return failed(diagnoseUnsendable(resolved.unsendable, variables?.environment));
    try {
      headers = new Headers(resolved.headers);
    } catch {
      // The message of `fetch` would repeat the value it refuses.
      return failed(HEADERS_REFUSED);
    }
    secrets = resolved.secrets;
  }
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeout = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const follow = followsRedirects(service);
  const { method } = service;
  try {
    const answer = headers
      ? await fetchWithHeaders(target, { headers, signal: abort, method }, follow)
      : {
          response: await fetch(target, {
            method,
            signal: abort,
            // Following a redirect hides its status: an expected 3xx could never match.
            redirect: follow ? "follow" : "manual",
          }),
        };
    if (!answer) return failed(TOO_MANY_REDIRECTS, elapsed());
    const { response } = answer;
    const latencyMs = elapsed();
    const { status } = response;
    const leftFor = "leftFor" in answer ? answer.leftFor : undefined;
    const expected = isExpected(service.expect, status);
    const { contains } = service;
    const searched = contains !== undefined && expected && leftFor === undefined;
    // The latency is taken before the body is read: `contains` does not change it.
    // A body is read once: the detail gets its own copy when the text is searched too.
    const shown = detail ? describeResponse(searched ? response.clone() : response) : undefined;
    const body = searched ? await searchBody(response.body, contains) : "found";
    const described = shown ? { response: maskedDetail(await shown, secrets) } : {};
    if (!detail && !searched) await response.body?.cancel();
    let diagnosis: Diagnosis | undefined;
    if (leftFor !== undefined) diagnosis = diagnoseForeignRedirect(service, leftFor);
    else if (!expected) diagnosis = diagnoseStatus(service, status);
    else if (body !== "found") diagnosis = diagnoseBody(contains ?? "", status, body);
    // The order of the keys is the order `--json` prints them in.
    const result = diagnosis
      ? { ...base, ok: false, status, latencyMs, ...diagnosis, ...described }
      : { ...base, ok: true, status, latencyMs, ...described };
    return { result, unknownIssuer: false };
  } catch (error) {
    const diagnosis = diagnoseFailure(error, service, timeoutMs);
    return {
      result: { ...base, ok: false, latencyMs: elapsed(), ...diagnosis },
      unknownIssuer: hasUnknownIssuer(error),
    };
  }
}

export function createHttpChecker(trust: SystemTrust = systemTrust): Checker {
  return {
    type: "http",
    async check(name, service, context) {
      const firstTry = !trust.tried;
      const first = await request(name, service, context);
      if (!first.unknownIssuer) return first.result;
      if (!(await trust.load())) {
        return { ...first.result, hint: unknownIssuerHint(service, false) };
      }
      return firstTry ? (await request(name, service, context)).result : first.result;
    },
  };
}

export const httpChecker = createHttpChecker();
