import type { Service } from "../config/schema";
import { diagnoseFailure, diagnoseStatus } from "./diagnosis";
import type { Checker } from "./types";

export function targetUrl(service: Service): string {
  const bareIpv6 = service.host.includes(":") && !service.host.startsWith("[");
  const host = bareIpv6 ? `[${service.host}]` : service.host;
  return `http://${host}:${service.port}${service.path}`;
}

function isExpected(expect: Service["expect"], status: number): boolean {
  if (expect === undefined) return status >= 200 && status < 300;
  return Array.isArray(expect) ? expect.includes(status) : expect === status;
}

function expectsRedirect(expect: Service["expect"]): boolean {
  return [expect ?? []].flat().some((status) => status >= 300 && status < 400);
}

export const httpChecker: Checker = {
  type: "http",
  async check(name, service, { timeoutMs, signal }) {
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
      await response.body?.cancel();
      const { status } = response;
      if (isExpected(service.expect, status)) return { ...base, ok: true, status, latencyMs };
      return { ...base, ok: false, status, latencyMs, ...diagnoseStatus(service, status) };
    } catch (error) {
      const diagnosis = diagnoseFailure(error, service, timeoutMs);
      return { ...base, ok: false, latencyMs: elapsed(), ...diagnosis };
    }
  },
};
