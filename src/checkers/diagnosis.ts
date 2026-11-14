import type { Service } from "../config/schema";
import { CONFIG_FILE, PROBE_DIR } from "../constants";

/** Why a check failed, and what to try next when the cause is a known one. */
export interface Diagnosis {
  error: string;
  hint?: string;
}

const CONFIG = `${PROBE_DIR}/${CONFIG_FILE}`;

const CERTIFICATE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const hostNotFound = (service: Service): Diagnosis => ({
  error: "host not found",
  hint: `"${service.host}" does not resolve: check \`host\` in ${CONFIG}`,
});

const NETWORK: Record<string, (service: Service) => Diagnosis> = {
  ECONNREFUSED: (service) => ({
    error: "connection refused",
    hint: `nothing listens on :${service.port}: is the service started?`,
  }),
  ECONNRESET: (service) => ({
    error: "connection reset",
    hint: `:${service.port} closed the connection without answering: does it speak plain http?`,
  }),
  ENOTFOUND: hostNotFound,
  EAI_AGAIN: hostNotFound,
  EHOSTUNREACH: (service) => ({
    error: "host unreachable",
    hint: `no route to ${service.host}: check the network or the VPN`,
  }),
};

/**
 * Explains an error thrown by `fetch`.
 * A code that is not known is returned as is, without a hint.
 */
export function diagnoseFailure(error: unknown, service: Service, timeoutMs: number): Diagnosis {
  if (error instanceof Error && error.name === "TimeoutError") {
    return {
      error: `timeout after ${timeoutMs / 1000}s`,
      hint: `still starting, or stuck? Give it more time: \`timeout\` in ${CONFIG}`,
    };
  }
  // fetch wraps the socket error in `cause`; with both IPv4 and IPv6 tried it is an AggregateError.
  const cause = (error as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code;
  if (!code) return { error: error instanceof Error ? error.message : String(error) };
  if (CERTIFICATE_CODES.has(code)) {
    return {
      error: `certificate rejected (${code})`,
      // Services are checked over http: a certificate can only come from a redirect to https.
      hint: "a redirect led to https with a certificate that is not trusted: renew it, or add its CA with NODE_EXTRA_CA_CERTS",
    };
  }
  return NETWORK[code]?.(service) ?? { error: code };
}

function describeExpected(expect: Service["expect"]): string {
  if (expect === undefined) return "2xx";
  return Array.isArray(expect) ? expect.join(" or ") : String(expect);
}

/** Explains an answer whose status is not the expected one. */
export function diagnoseStatus(service: Service, status: number): Diagnosis {
  const error = `expected ${describeExpected(service.expect)}, got ${status}`;
  if (status >= 500) return { error, hint: "the service answers with an error: look at its logs" };
  if (status === 404) {
    return { error, hint: `nothing at ${service.path}: check \`path\` in ${CONFIG}` };
  }
  return { error, hint: `the service answers: check \`path\` and \`expect\` in ${CONFIG}` };
}
