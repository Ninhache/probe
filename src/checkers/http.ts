import { masked, resolveHeaders, serviceVariables, templateParts } from "../config/headers";
import type { Service } from "../config/schema";
import { DEFAULT_TIMEOUT_SECONDS, MAX_REDIRECTS } from "../constants";
import {
  type Diagnosis,
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

/** The URL a check requests: the one the config gives, or the one its host, port and path make. */
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

/**
 * One header as a shell word. A variable stays a reference (`$API_TOKEN`), for the shell to fill
 * in: its value is never written in a command.
 */
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

/**
 * Returns the curl command that sends what the check sends: same URL, same headers, same time
 * limit, redirects followed unless a 3xx is expected. With headers, `-L` is left out: curl would
 * send them to whatever host a redirect names. It prints the status line and the headers before
 * the body.
 */
export function curlCommand(service: Service): string {
  const headers = Object.entries(service.headers ?? {});
  const follow = expectsRedirect(service.expect) || headers.length > 0 ? "" : " -L";
  const seconds = service.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  const sent = headers.map(([name, value]) => ` -H ${shellHeader(name, value)}`).join("");
  return `curl -i${follow} --max-time ${seconds}${sent} ${shellQuoted(targetUrl(service))}`;
}

function isExpected(expect: Service["expect"], status: number): boolean {
  if (expect === undefined) return status >= 200 && status < 300;
  return Array.isArray(expect) ? expect.includes(status) : expect === status;
}

function expectsRedirect(expect: Service["expect"]): boolean {
  return [expect ?? []].flat().some((status) => status >= 300 && status < 400);
}

/**
 * Says which variables the curl command expects from the shell that runs it and does not find in
 * `env`; undefined when it needs none. probe may get them from `local.yml`, a shell does not.
 */
export function curlNote(service: Service, env: NodeJS.ProcessEnv): string | undefined {
  const absent = serviceVariables(service.headers).filter((name) => !env[name]);
  if (absent.length === 0) return undefined;
  return `it reads ${absent.join(", ")} from the shell that runs it: export ${absent.length > 1 ? "them" : "it"} there first`;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/**
 * `fetch` for a service that sends headers. A redirect is followed by hand, and only on the same
 * origin: `fetch` would carry the headers to any host a redirect names. `leftFor` is the origin a
 * redirect asked to go to instead; the response is then that redirect.
 */
async function fetchWithHeaders(
  target: string,
  init: { headers: Headers; signal: AbortSignal },
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

/** One request to the service: its result, and whether it failed for an issuer nobody vouches for. */
async function request(
  name: string,
  service: Service,
  { timeoutMs, signal, detail, variables }: CheckContext,
): Promise<{ result: CheckResult; unknownIssuer: boolean }> {
  const target = targetUrl(service);
  const base = { name, type: "http", target };
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
      return failed(diagnoseUnset(resolved.unset, variables?.localUnreadable === true));
    }
    if ("unsendable" in resolved) return failed(diagnoseUnsendable(resolved.unsendable));
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
  const follow = !expectsRedirect(service.expect);
  try {
    const answer = headers
      ? await fetchWithHeaders(target, { headers, signal: abort }, follow)
      : {
          response: await fetch(target, {
            signal: abort,
            // Following a redirect hides its status: an expected 3xx could never match.
            redirect: follow ? "follow" : "manual",
          }),
        };
    if (!answer) return failed(TOO_MANY_REDIRECTS, elapsed());
    const { response } = answer;
    const latencyMs = elapsed();
    const { status } = response;
    // The latency is taken before the body: reading it changes neither the time nor the verdict.
    const described = detail
      ? { response: maskedDetail(await describeResponse(response), secrets) }
      : {};
    if (!detail) await response.body?.cancel();
    const leftFor = "leftFor" in answer ? answer.leftFor : undefined;
    // The order of the keys is the order `--json` prints them in.
    const result =
      isExpected(service.expect, status) && leftFor === undefined
        ? { ...base, ok: true, status, latencyMs, ...described }
        : {
            ...base,
            ok: false,
            status,
            latencyMs,
            ...(leftFor === undefined
              ? diagnoseStatus(service, status)
              : diagnoseForeignRedirect(service, leftFor)),
            ...described,
          };
    return { result, unknownIssuer: false };
  } catch (error) {
    const diagnosis = diagnoseFailure(error, service, timeoutMs);
    return {
      result: { ...base, ok: false, latencyMs: elapsed(), ...diagnosis },
      unknownIssuer: hasUnknownIssuer(error),
    };
  }
}

/**
 * Builds the http checker. A certificate refused for its issuer gets a second request once the
 * system store is trusted too; `trust` says how, so a test can stand in for the store.
 */
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
