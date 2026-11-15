import { serviceVariables } from "../config/headers";
import type { Service } from "../config/schema";
import { CONFIG_FILE, LOCAL_FILE, PROBE_DIR } from "../constants";

/** Why a check failed, and what to try next when the cause is a known one. */
export interface Diagnosis {
  error: string;
  hint?: string;
}

const CONFIG = `${PROBE_DIR}/${CONFIG_FILE}`;
const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;

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
  if (status === 401 || status === 403) {
    return {
      error,
      hint: service.headers
        ? `the service refuses what is sent: check ${sentBy(service)}`
        : `the service asks for credentials: give it \`headers\` in ${CONFIG}`,
    };
  }
  const address = service.url === undefined ? "path" : "url";
  return { error, hint: `the service answers: check \`${address}\` and \`expect\` in ${CONFIG}` };
}

/** What to look at when the headers of a service did not do: its variables, else the headers. */
function sentBy(service: Service): string {
  const variables = serviceVariables(service.headers);
  return variables.length > 0 ? variables.join(", ") : `\`headers\` in ${CONFIG}`;
}

const setCommand = (name: string) => `probe var ${name}`;

/** Explains headers that refer to variables nothing sets: no request is sent. */
export function diagnoseUnset(names: string[], localUnreadable: boolean): Diagnosis {
  const [first = ""] = names;
  const error = `${names.join(", ")} ${names.length > 1 ? "are" : "is"} not set`;
  if (localUnreadable) {
    return { error, hint: `${LOCAL} is not valid YAML: fix it, or export ${first}` };
  }
  return { error, hint: `set it for this machine: ${setCommand(first)} (or export it)` };
}

/** Explains variables whose value cannot go in a header, without showing it. */
export function diagnoseUnsendable(names: string[]): Diagnosis {
  const [first = ""] = names;
  return {
    error: `${names.join(", ")} cannot go in a header`,
    hint: `a line break or an unusual character in its value: set it again with ${setCommand(first)}`,
  };
}

/** Explains a redirect to another origin, where the headers of the service are not sent. */
export function diagnoseForeignRedirect(service: Service, origin: string): Diagnosis {
  const error = `redirected to ${origin}`;
  const bare = (host: string) => host.replace(/^www\./, "");
  // The same site under another scheme, port or `www.`: the address moved, nobody asks to log in.
  if (bare(new URL(origin).hostname) === bare(service.host)) {
    return {
      error,
      hint: `the service moved there, and headers stay on the address they are for: set \`url\` to it in ${CONFIG}`,
    };
  }
  return {
    error,
    hint: `headers stay on the host they are for. A login page? Check ${sentBy(service)}`,
  };
}

export const TOO_MANY_REDIRECTS: Diagnosis = { error: "too many redirects" };

/** Said when `fetch` refuses the headers themselves: its own message could repeat a value. */
export const HEADERS_REFUSED: Diagnosis = {
  error: "headers cannot be sent",
  hint: `check \`headers\` in ${CONFIG}`,
};
