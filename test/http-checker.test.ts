import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpChecker, targetUrl } from "../src/checkers/http";
import { resolveTimeoutMs, runChecks } from "../src/checkers/run";
import type { Config, Service } from "../src/config/schema";

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case "/health":
        response.writeHead(200).end("ok");
        break;
      case "/created":
        response.writeHead(201).end();
        break;
      case "/moved":
        response.writeHead(302, { location: "/health" }).end();
        break;
      case "/slow":
        setTimeout(() => response.writeHead(200).end("late"), 2_000);
        break;
      default:
        response.writeHead(500).end("boom");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const service = (overrides: Partial<Service> = {}): Service => ({
  host: "127.0.0.1",
  port,
  path: "/health",
  ...overrides,
});

const check = (overrides: Partial<Service> = {}, timeoutMs = 1_000) =>
  httpChecker.check("api", service(overrides), { timeoutMs });

describe("targetUrl", () => {
  it("wraps a bare IPv6 host, not an already bracketed one", () => {
    const service = { port: 80, path: "/" };
    expect(targetUrl({ ...service, host: "::1" })).toBe("http://[::1]:80/");
    expect(targetUrl({ ...service, host: "[::1]" })).toBe("http://[::1]:80/");
  });
});

describe("http checker", () => {
  it("reports a 2xx service as up, with status and latency", async () => {
    const result = await check();

    expect(result).toMatchObject({
      name: "api",
      type: "http",
      ok: true,
      status: 200,
      target: `http://127.0.0.1:${port}/health`,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(1_000);
    expect(result.error).toBeUndefined();
  });

  it("accepts any 2xx by default", async () => {
    expect((await check({ path: "/created" })).ok).toBe(true);
  });

  it("reports a 500 as down", async () => {
    expect(await check({ path: "/boom" })).toMatchObject({
      ok: false,
      status: 500,
      error: "expected 2xx, got 500",
    });
  });

  it("honours a single expected status", async () => {
    expect((await check({ path: "/boom", expect: 500 })).ok).toBe(true);
    expect(await check({ expect: 204 })).toMatchObject({
      ok: false,
      error: "expected 204, got 200",
    });
  });

  it("honours a list of expected statuses", async () => {
    expect((await check({ path: "/created", expect: [200, 201] })).ok).toBe(true);
    expect((await check({ path: "/boom", expect: [200, 201] })).error).toBe(
      "expected 200 or 201, got 500",
    );
  });

  it("follows redirects and judges the final status", async () => {
    expect(await check({ path: "/moved" })).toMatchObject({ ok: true, status: 200 });
  });

  it("does not follow a redirect when a 3xx is expected", async () => {
    expect(await check({ path: "/moved", expect: 302 })).toMatchObject({ ok: true, status: 302 });
    expect(await check({ path: "/moved", expect: [200, 302] })).toMatchObject({ status: 302 });
    expect(await check({ expect: [200, 302] })).toMatchObject({ ok: true, status: 200 });
  });

  it("gives up after the timeout", async () => {
    const result = await check({ path: "/slow" }, 100);

    expect(result).toMatchObject({ ok: false, error: "timeout after 0.1s" });
    expect(result.status).toBeUndefined();
    expect(result.latencyMs).toBeLessThan(1_000);
  });

  it("reports a closed port as connection refused", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    expect(await check({ port: closedPort })).toMatchObject({
      ok: false,
      error: "connection refused",
    });
  });
});

describe("runChecks", () => {
  const config = (): Config => ({
    schemaVersion: 1,
    services: { api: service(), broken: service({ path: "/boom" }) },
  });

  it("checks every service when no name is given", async () => {
    const results = await runChecks(config(), [], { timeoutMs: 1_000 });
    expect(results.map(({ name, ok }) => [name, ok])).toEqual([
      ["api", true],
      ["broken", false],
    ]);
  });

  it("checks only the named services", async () => {
    const results = await runChecks(config(), ["broken"], { timeoutMs: 1_000 });
    expect(results.map((result) => result.name)).toEqual(["broken"]);
  });

  it("rejects an unknown name", async () => {
    await expect(runChecks(config(), ["nope"], { timeoutMs: 1_000 })).rejects.toThrowError(
      /unknown service: nope\. Known: api, broken/,
    );
  });

  it("gives a service its own timeout instead of the default", async () => {
    const slow: Config = {
      schemaVersion: 1,
      services: { slow: service({ path: "/slow", timeout: 0.1 }) },
    };

    const [result] = await runChecks(slow, [], { timeoutMs: 10_000 });

    expect(result).toMatchObject({ ok: false, error: "timeout after 0.1s" });
  });

  it("lets a forced timeout replace the service's own", async () => {
    const slow: Config = {
      schemaVersion: 1,
      services: { slow: service({ path: "/slow", timeout: 10 }) },
    };

    const [result] = await runChecks(slow, [], { timeoutMs: 100, forceTimeout: true });

    expect(result).toMatchObject({ ok: false, error: "timeout after 0.1s" });
  });
});

describe("resolveTimeoutMs", () => {
  it.each([
    ["the default without a timeout of its own", {}, { timeoutMs: 3_000 }, 3_000],
    ["its own timeout over the default", { timeout: 10 }, { timeoutMs: 3_000 }, 10_000],
    ["a fraction of a second", { timeout: 0.25 }, { timeoutMs: 3_000 }, 250],
    ["the forced value", { timeout: 10 }, { timeoutMs: 500, forceTimeout: true }, 500],
    [
      "the bound when its own is longer",
      { timeout: 10 },
      { timeoutMs: 3_000, maxTimeoutMs: 1_200 },
      1_200,
    ],
    ["the bound when the default is longer", {}, { timeoutMs: 3_000, maxTimeoutMs: 800 }, 800],
    [
      "its own when the bound is longer",
      { timeout: 1 },
      { timeoutMs: 3_000, maxTimeoutMs: 5_000 },
      1_000,
    ],
  ])("gives %s", (_label, overrides, options, expected) => {
    expect(resolveTimeoutMs(service(overrides), options)).toBe(expected);
  });
});
