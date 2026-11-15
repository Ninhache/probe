import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpChecker } from "../src/checkers/http";
import { HIDDEN_VALUE } from "../src/checkers/response";
import { runChecks } from "../src/checkers/run";
import { RESPONSE_BODY_BYTES } from "../src/constants";

const ESCAPE = String.fromCharCode(27);
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case "/json":
        response
          .writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": ["session=abc123", "theme=dark"],
            "x-api-key": "s3cret",
            "x-request-id": "42",
          })
          .end('{"status":"ok"}\n');
        break;
      case "/big":
        response.writeHead(200, { "content-type": "text/plain" }).end("a".repeat(10_000));
        break;
      case "/endless":
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("first\n");
        break;
      case "/image":
        response.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([137, 80, 0, 1]));
        break;
      case "/untyped":
        response.writeHead(200).end(Buffer.from([1, 0, 2]));
        break;
      case "/escape":
        response
          .writeHead(200, { "content-type": "text/plain" })
          .end(`red${ESCAPE}[31m\tline\r\nnext${String.fromCharCode(7)}`);
        break;
      case "/empty":
        response.writeHead(204).end();
        break;
      default:
        response.writeHead(500, { "content-type": "text/plain" }).end("boom");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const check = (path: string, detail = true, timeoutMs = 2_000) =>
  httpChecker.check("api", { host: "127.0.0.1", port, path }, { timeoutMs, detail });

describe("response detail", () => {
  it("is left out unless the check is asked for it", async () => {
    const result = await check("/json", false);

    expect(Object.keys(result).sort()).toEqual(
      ["latencyMs", "name", "ok", "status", "target", "type"].sort(),
    );
  });

  it("is not asked for by the runner on its own", async () => {
    const config = {
      schemaVersion: 1 as const,
      services: { api: { host: "127.0.0.1", port, path: "/json" } },
    };

    const [plain] = await runChecks(config, [], { timeoutMs: 2_000 });
    const [detailed] = await runChecks(config, [], { timeoutMs: 2_000, detail: true });

    expect(plain).not.toHaveProperty("response");
    expect(detailed?.response?.body).toBe('{"status":"ok"}');
  });

  it("gives the status text, the headers and the body of a text response", async () => {
    const { ok, status, response } = await check("/json");

    expect({ ok, status }).toEqual({ ok: true, status: 200 });
    expect(response?.statusText).toBe("OK");
    expect(response?.headers).toContainEqual(["content-type", "application/json; charset=utf-8"]);
    expect(response?.headers).toContainEqual(["x-request-id", "42"]);
    expect(response?.body).toBe('{"status":"ok"}');
    expect(response?.bodyCut).toBeUndefined();
  });

  it("hides the value of every header that can carry a secret", async () => {
    const { response } = await check("/json");

    const cookies = response?.headers.filter(([name]) => name === "set-cookie") ?? [];
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.every(([, value]) => value === HIDDEN_VALUE)).toBe(true);
    expect(response?.headers).toContainEqual(["x-api-key", HIDDEN_VALUE]);
    expect(JSON.stringify(response)).not.toMatch(/abc123|s3cret|theme=dark/);
  });

  it("keeps the start of a long body and says it was cut", async () => {
    const { response } = await check("/big");

    expect(response?.body).toBe("a".repeat(RESPONSE_BODY_BYTES));
    expect(response?.bodyCut).toBe(true);
  });

  it("does not wait for a body that never ends, and keeps the service up", async () => {
    const started = performance.now();
    const { ok, response } = await check("/endless", true, 5_000);

    expect(ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(response?.body).toBe("first");
    expect(response?.bodyCut).toBe(true);
  });

  it("keeps the service up when the time limit ends while the body is read", async () => {
    const { ok, status, response } = await check("/endless", true, 400);

    expect({ ok, status }).toEqual({ ok: true, status: 200 });
    expect(response?.body).toBe("first");
  });

  it("names a body that is not text instead of showing it", async () => {
    expect((await check("/image")).response).toMatchObject({
      bodyNote: "image/png body, not shown",
    });
    expect((await check("/image")).response?.body).toBeUndefined();
    expect((await check("/untyped")).response?.bodyNote).toBe("binary body, not shown");
  });

  it("removes what a terminal would obey from the body", async () => {
    const { response } = await check("/escape");

    expect(response?.body).toBe("red[31m  line\nnext");
    expect(JSON.stringify(response)).not.toContain("\\u001b");
  });

  it("has no body for an empty response, and describes a failed one too", async () => {
    expect((await check("/empty")).response?.body).toBeUndefined();

    const failed = await check("/nope");
    expect(failed.ok).toBe(false);
    expect(failed.response).toMatchObject({ statusText: "Internal Server Error", body: "boom" });
  });
});
