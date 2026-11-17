import { describe, expect, it } from "vitest";
import { addressFields, addressProblem, addressText } from "../src/config/service-input";

const SECRET = "s3cr3t-value";

describe("a service address", () => {
  it.each([
    ["3000", { host: "localhost", port: 3000, path: "/" }],
    ["localhost:3000", { host: "localhost", port: 3000, path: "/" }],
    ["Api.local:8080/health", { host: "Api.local", port: 8080, path: "/health" }],
    ["http://127.0.0.1:80/", { host: "127.0.0.1", port: 80, path: "/" }],
    ["[::1]:3000/up", { host: "::1", port: 3000, path: "/up" }],
  ])("should keep host, port and path when %j is plain http with a port", (typed, fields) => {
    expect(addressFields(typed)).toEqual(fields);
  });

  it.each([
    ["https://api.example.com/health", "https://api.example.com/health", 443],
    ["api.example.com", "http://api.example.com", 80],
    [
      "https://api.example.com:8443/health?full=1",
      "https://api.example.com:8443/health?full=1",
      8443,
    ],
  ])("should give %j as a url", (typed, url, port) => {
    expect(addressFields(typed)).toMatchObject({ url, port });
  });

  it("should keep a port written in an address without a scheme", () => {
    expect(addressFields("api.example.com:8080")).toEqual({
      host: "api.example.com",
      port: 8080,
      path: "/",
    });
  });

  it.each([
    { host: "localhost", port: 3000, path: "/" },
    { host: "Api.local", port: 8080, path: "/health?x=1" },
    { host: "::1", port: 3000, path: "/up" },
  ])("should read back host, port and path unchanged: %o", (fields) => {
    expect(addressFields(addressText(fields))).toEqual(fields);
  });

  it("should read back a url as it is written", () => {
    const url = "https://API.example.com/health?full=1";

    expect(addressText({ url, host: "api.example.com", port: 443, path: "/health?full=1" })).toBe(
      url,
    );
    expect(addressFields(url).url).toBe(url);
  });

  it.each(["", "ftp://example.com", "http://", "localhost:0", "localhost:70000", "a b:3000"])(
    "should refuse %j",
    (typed) => {
      expect(addressProblem(typed)).toBeDefined();
    },
  );

  it("should refuse a user and a password without repeating them", () => {
    const problem = addressProblem(`https://admin:${SECRET}@api.example.com`);

    expect(problem).toBe("Expected a URL without a user or a password");
    expect(problem).not.toContain(SECRET);
  });
});
