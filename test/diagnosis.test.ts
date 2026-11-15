import { describe, expect, it } from "vitest";
import { diagnoseFailure, diagnoseStatus } from "../src/checkers/diagnosis";
import { serviceSchemaV1 } from "../src/config/schema";

const service = serviceSchemaV1.parse({ host: "api.test", port: 3000, path: "/health" });
const secure = serviceSchemaV1.parse({ url: "https://secure.test:8443/health" });
const fetchError = (cause: unknown) => new TypeError("fetch failed", { cause });

describe("diagnoseFailure", () => {
  it("says nothing listens on the port when the connection is refused", () => {
    expect(diagnoseFailure(fetchError({ code: "ECONNREFUSED" }), service, 3000)).toEqual({
      error: "connection refused",
      hint: "nothing listens on :3000: is the service started?",
    });
  });

  it("reads the code of the first attempt when IPv4 and IPv6 were both tried", () => {
    const error = fetchError({ errors: [{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }] });

    expect(diagnoseFailure(error, service, 3000).error).toBe("connection refused");
  });

  it("points at the timeout setting when the service does not answer in time", () => {
    const error = new DOMException("The operation timed out", "TimeoutError");

    expect(diagnoseFailure(error, service, 1500)).toEqual({
      error: "timeout after 1.5s",
      hint: "still starting, or stuck? Give it more time: `timeout` in .probe/config.yml",
    });
  });

  it.each(["ENOTFOUND", "EAI_AGAIN"])("names the host that does not resolve on %s", (code) => {
    expect(diagnoseFailure(fetchError({ code }), service, 3000)).toEqual({
      error: "host not found",
      hint: '"api.test" does not resolve: check `host` in .probe/config.yml',
    });
  });

  it.each([
    ["EHOSTUNREACH", "host unreachable", "no route to api.test"],
    ["ECONNRESET", "connection reset", "does it speak plain http?"],
  ])("explains %s", (code, error, hint) => {
    const diagnosis = diagnoseFailure(fetchError({ code }), service, 3000);

    expect(diagnosis.error).toBe(error);
    expect(diagnosis.hint).toContain(hint);
  });

  it.each([
    ["CERT_HAS_EXPIRED", "certificate expired", "renew the certificate"],
    ["CERT_NOT_YET_VALID", "certificate not valid yet", "clock of this machine"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "certificate for another host", '"secure.test"'],
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "certificate not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)",
      "NODE_EXTRA_CA_CERTS",
    ],
  ])("gives the reason of %s in words, for an https service", (code, error, hint) => {
    const diagnosis = diagnoseFailure(fetchError({ code }), secure, 3000);

    expect(diagnosis.error).toBe(error);
    expect(diagnosis.hint).toContain(hint);
    expect(diagnosis.hint).not.toContain("redirect");
  });

  it("says a redirect led to https when an http service meets a certificate", () => {
    const diagnosis = diagnoseFailure(fetchError({ code: "CERT_HAS_EXPIRED" }), service, 3000);

    expect(diagnosis).toEqual({
      error: "certificate expired",
      hint: "a redirect led to https: renew the certificate of the service",
    });
  });

  it("points at `url`, the only address key of a service declared by one", () => {
    const wrongName = fetchError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });

    expect(diagnoseFailure(wrongName, secure, 3000).hint).toContain("check `url` in");
    expect(diagnoseFailure(fetchError({ code: "ENOTFOUND" }), secure, 3000).hint).toContain(
      "check `url` in",
    );
    expect(diagnoseStatus(secure, 404).hint).toContain("check `url` in");
    expect(diagnoseStatus(service, 404).hint).toContain("check `path` in");
  });

  it("reads the scheme of a URL whatever its case", () => {
    const shouting = serviceSchemaV1.parse({ url: "HTTPS://secure.test/health" });
    const diagnosis = diagnoseFailure(fetchError({ code: "CERT_HAS_EXPIRED" }), shouting, 3000);

    expect(diagnosis.hint).toBe("renew the certificate of the service");
  });

  it("asks whether the port speaks https when an https service hangs up", () => {
    const diagnosis = diagnoseFailure(fetchError({ code: "ECONNRESET" }), secure, 3000);

    expect(diagnosis.hint).toContain("does it speak https?");
  });

  it("shows an unknown code as is, without a hint", () => {
    expect(diagnoseFailure(fetchError({ code: "EPIPE" }), service, 3000)).toEqual({
      error: "EPIPE",
    });
  });

  it("shows the message of an error that has no code, without a hint", () => {
    expect(diagnoseFailure(new Error("boom"), service, 3000)).toEqual({ error: "boom" });
    expect(diagnoseFailure("boom", service, 3000)).toEqual({ error: "boom" });
  });
});

describe("diagnoseStatus", () => {
  it("sends to the logs of the service on a 5xx", () => {
    expect(diagnoseStatus(service, 503)).toEqual({
      error: "expected 2xx, got 503",
      hint: "the service answers with an error: look at its logs",
    });
  });

  it("points at the path on a 404", () => {
    expect(diagnoseStatus(service, 404)).toEqual({
      error: "expected 2xx, got 404",
      hint: "nothing at /health: check `path` in .probe/config.yml",
    });
  });

  it("points at the method on a 405", () => {
    expect(diagnoseStatus({ ...service, method: "DELETE" }, 405).hint).toBe(
      "the service refuses DELETE there: check `method` in .probe/config.yml",
    );
    expect(diagnoseStatus(service, 405).hint).toContain("refuses GET there");
  });

  it("says a redirect is not followed with a method other than GET or HEAD", () => {
    expect(diagnoseStatus({ ...service, method: "POST" }, 302).hint).toBe(
      "a POST is sent once, redirects are not followed: check `path` in .probe/config.yml",
    );
    expect(diagnoseStatus({ ...service, method: "HEAD" }, 302).hint).toContain("check `path` and");
  });

  it("points at path and expect on any other status", () => {
    const strict = { ...service, expect: [200, 204] };

    expect(diagnoseStatus(strict, 201)).toEqual({
      error: "expected 200 or 204, got 201",
      hint: "the service answers: check `path` and `expect` in .probe/config.yml",
    });
  });
});
