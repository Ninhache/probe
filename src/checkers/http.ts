import type { Service } from "../config/schema";
import type { Checker } from "./types";

const REASONS: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset",
  ENOTFOUND: "host not found",
  EAI_AGAIN: "host not found",
  EHOSTUNREACH: "host unreachable",
};

export function targetUrl(service: Service): string {
  const host = service.host.includes(":") ? `[${service.host}]` : service.host;
  return `http://${host}:${service.port}${service.path}`;
}

function isExpected(expect: Service["expect"], status: number): boolean {
  if (expect === undefined) return status >= 200 && status < 300;
  return Array.isArray(expect) ? expect.includes(status) : expect === status;
}

function describeExpected(expect: Service["expect"]): string {
  if (expect === undefined) return "2xx";
  return Array.isArray(expect) ? expect.join(" or ") : String(expect);
}

function failureReason(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `timeout after ${timeoutMs / 1000}s`;
  }
  // fetch wraps the socket error in `cause`; with both IPv4 and IPv6 tried it is an AggregateError.
  const cause = (error as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code;
  if (code) return REASONS[code] ?? code;
  return error instanceof Error ? error.message : String(error);
}

export const httpChecker: Checker = {
  type: "http",
  async check(name, service, { timeoutMs }) {
    const target = targetUrl(service);
    const base = { name, type: "http", target };
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
      const latencyMs = elapsed();
      await response.body?.cancel();
      const { status } = response;
      if (isExpected(service.expect, status)) return { ...base, ok: true, status, latencyMs };
      const error = `expected ${describeExpected(service.expect)}, got ${status}`;
      return { ...base, ok: false, status, latencyMs, error };
    } catch (error) {
      return { ...base, ok: false, latencyMs: elapsed(), error: failureReason(error, timeoutMs) };
    }
  },
};
