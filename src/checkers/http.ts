import type { Service } from "../config/schema";
import { DEFAULT_TIMEOUT_SECONDS } from "../constants";
import { diagnoseFailure, diagnoseStatus, hasUnknownIssuer, unknownIssuerHint } from "./diagnosis";
import { describeResponse } from "./response";
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

/**
 * Returns the curl command that sends what the check sends: same URL, same time limit, redirects
 * followed unless a 3xx is expected. It prints the status line and the headers before the body.
 */
export function curlCommand(service: Service): string {
  const follow = expectsRedirect(service.expect) ? "" : " -L";
  const seconds = service.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  return `curl -i${follow} --max-time ${seconds} ${shellQuoted(targetUrl(service))}`;
}

function isExpected(expect: Service["expect"], status: number): boolean {
  if (expect === undefined) return status >= 200 && status < 300;
  return Array.isArray(expect) ? expect.includes(status) : expect === status;
}

function expectsRedirect(expect: Service["expect"]): boolean {
  return [expect ?? []].flat().some((status) => status >= 300 && status < 400);
}

/** One request to the service: its result, and whether it failed for an issuer nobody vouches for. */
async function request(
  name: string,
  service: Service,
  { timeoutMs, signal, detail }: CheckContext,
): Promise<{ result: CheckResult; unknownIssuer: boolean }> {
  const target = targetUrl(service);
  const base = { name, type: "http", target };
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(target, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      // Following a redirect hides its status: an expected 3xx could never match.
      redirect: expectsRedirect(service.expect) ? "manual" : "follow",
    });
    const latencyMs = elapsed();
    const { status } = response;
    // The latency is taken before the body: reading it changes neither the time nor the verdict.
    const described = detail ? { response: await describeResponse(response) } : {};
    if (!detail) await response.body?.cancel();
    // The order of the keys is the order `--json` prints them in.
    const result = isExpected(service.expect, status)
      ? { ...base, ok: true, status, latencyMs, ...described }
      : { ...base, ok: false, status, latencyMs, ...diagnoseStatus(service, status), ...described };
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
