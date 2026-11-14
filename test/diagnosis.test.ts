import { describe, expect, it } from "vitest";
import { diagnoseFailure, diagnoseStatus } from "../src/checkers/diagnosis";
import { serviceSchemaV1 } from "../src/config/schema";

const service = serviceSchemaV1.parse({ host: "api.test", port: 3000, path: "/health" });
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

  it.each(["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"])(
    "keeps the code and explains the redirect to https on %s",
    (code) => {
      const diagnosis = diagnoseFailure(fetchError({ code }), service, 3000);

      expect(diagnosis.error).toBe(`certificate rejected (${code})`);
      expect(diagnosis.hint).toContain("NODE_EXTRA_CA_CERTS");
    },
  );

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

  it("points at path and expect on any other status", () => {
    const strict = { ...service, expect: [200, 204] };

    expect(diagnoseStatus(strict, 201)).toEqual({
      error: "expected 200 or 204, got 201",
      hint: "the service answers: check `path` and `expect` in .probe/config.yml",
    });
  });
});
