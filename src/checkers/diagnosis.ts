import type { Service } from "../config/schema";
import { CONFIG_FILE, PROBE_DIR } from "../constants";

/** Why a check failed, and what to try next when the cause is a known one. */
export interface Diagnosis {
  error: string;
  hint?: string;
}

const CONFIG = `${PROBE_DIR}/${CONFIG_FILE}`;

/** The certificate is fine in itself; nothing trusted here signed it. */
const UNKNOWN_ISSUER_CODES = [
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
];

const CERTIFICATE_CODES = new Set([
  ...UNKNOWN_ISSUER_CODES,
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** The code of the socket error under a failed fetch, when it has one. */
function failureCode(error: unknown): string | undefined {
  // fetch wraps the socket error in `cause`; with both IPv4 and IPv6 tried it is an AggregateError.
  const cause = (error as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  return cause?.code ?? cause?.errors?.[0]?.code;
}

/** Whether a check failed because nothing trusted here signed the certificate. */
export function hasUnknownIssuer(error: unknown): boolean {
  return UNKNOWN_ISSUER_CODES.includes(failureCode(error) ?? "");
}

/** Where to look in the config: a service declared by `url` has no `host` or `path` key. */
const check = (service: Service, key: "host" | "path") =>
  `check \`${service.url === undefined ? key : "url"}\` in ${CONFIG}`;

const isHttps = (service: Service) =>
  service.url !== undefined && URL.parse(service.url)?.protocol === "https:";

// Over http, a certificate can only come from a redirect to https.
const redirectLead = (service: Service) => (isHttps(service) ? "" : "a redirect led to https: ");

/**
 * What to do about a certificate nothing trusted here signed. `systemStore` says whether this
 * Node can trust the system store: on one that cannot, only the file of the CA helps.
 */
export function unknownIssuerHint(service: Service, systemStore: boolean): string {
  const remedy = systemStore
    ? "add the CA to the system store, or give its file in NODE_EXTRA_CA_CERTS"
    : "give the file of the CA in NODE_EXTRA_CA_CERTS";
  return `${redirectLead(service)}self-signed, or from a local CA: ${remedy}`;
}

const hostNotFound = (service: Service): Diagnosis => ({
  error: "host not found",
  hint: `"${service.host}" does not resolve: ${check(service, "host")}`,
});

/** Explains a certificate that was refused: the reason first, the code only when it adds to it. */
function diagnoseCertificate(code: string, service: Service): Diagnosis {
  const lead = redirectLead(service);
  if (code === "CERT_HAS_EXPIRED") {
    return { error: "certificate expired", hint: `${lead}renew the certificate of the service` };
  }
  if (code === "CERT_NOT_YET_VALID") {
    return {
      error: "certificate not valid yet",
      hint: `${lead}check the dates of the certificate and the clock of this machine`,
    };
  }
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return {
      error: "certificate for another host",
      hint: `${lead}the certificate does not name "${service.host}": ${check(service, "host")}`,
    };
  }
  return {
    error: `certificate not trusted (${code})`,
    hint: unknownIssuerHint(service, true),
  };
}

/** Start of the codes OpenSSL gives when the other side does not speak TLS. */
const TLS_PROTOCOL_PREFIX = "ERR_SSL_";

const NETWORK: Record<string, (service: Service) => Diagnosis> = {
  ECONNREFUSED: (service) => ({
    error: "connection refused",
    hint: `nothing listens on :${service.port}: is the service started?`,
  }),
  ECONNRESET: (service) => ({
    error: "connection reset",
    hint: `:${service.port} closed the connection without answering: does it speak ${isHttps(service) ? "https" : "plain http"}?`,
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
  const code = failureCode(error);
  if (!code) return { error: error instanceof Error ? error.message : String(error) };
  if (CERTIFICATE_CODES.has(code)) return diagnoseCertificate(code, service);
  // The code changes with the Node version; all of them mean the answer was not TLS.
  if (code.startsWith(TLS_PROTOCOL_PREFIX)) {
    return {
      error: "no https on this port",
      hint: `:${service.port} does not answer in https: does it speak plain http?`,
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
    return { error, hint: `nothing at ${service.path}: ${check(service, "path")}` };
  }
  const address = service.url === undefined ? "path" : "url";
  return { error, hint: `the service answers: check \`${address}\` and \`expect\` in ${CONFIG}` };
}
