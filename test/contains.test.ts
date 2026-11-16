import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChecks } from "../src/checkers/run";
import { type Config, serviceSchemaV1 } from "../src/config/schema";
import { CONTAINS_BODY_BYTES } from "../src/constants";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const HEALTHY = '"status":"ok"';
const SPLIT_PAUSE_MS = 50;

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case "/ok":
        response.writeHead(200).end(`{${HEALTHY}}`);
        break;
      case "/sick":
        response.writeHead(200).end('{"status":"degraded"}');
        break;
      case "/split":
        response.writeHead(200).write('{"sta');
        setTimeout(() => response.end('tus":"ok"}'), SPLIT_PAUSE_MS);
        break;
      case "/empty":
        response.writeHead(200).end();
        break;
      case "/stalled":
        response.writeHead(200).write("starting");
        break;
      case "/early":
        response.writeHead(200).write(`{${HEALTHY}`);
        break;
      case "/big":
        response.writeHead(200).end(`${"a".repeat(CONTAINS_BODY_BYTES + 1)}${HEALTHY}`);
        break;
      default:
        response.writeHead(500).end(`{${HEALTHY}}`);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("contains in the config", () => {
  it("is absent from a service that does not give one", () => {
    expect(serviceSchemaV1.parse({ port: 3000 })).not.toHaveProperty("contains");
  });

  it("is kept as written, spaces included", () => {
    expect(serviceSchemaV1.parse({ port: 3000, contains: " ok " }).contains).toBe(" ok ");
  });

  it.each(["", "   ", "two\nlines", "tab\there", 3, ["ok"]])("refuses %j", (contains) => {
    expect(serviceSchemaV1.safeParse({ port: 3000, contains }).success).toBe(false);
  });

  it("is refused with HEAD, whose response has no body", () => {
    const parsed = serviceSchemaV1.safeParse({ port: 3000, method: "head", contains: "ok" });

    expect(parsed.error?.issues[0]).toMatchObject({ path: ["contains"] });
    expect(parsed.error?.issues[0]?.message).toContain("HEAD");
  });
});

describe("a check with contains", () => {
  const config = (path: string, more: object = {}): Config => ({
    schemaVersion: 1,
    services: { api: { host: "127.0.0.1", port, path, contains: HEALTHY, ...more } },
  });
  const check = async (path: string, more: object = {}, detail = false) => {
    const [result] = await runChecks(config(path, more), [], { timeoutMs: 300, detail });
    return result;
  };

  it("is up when the body holds the text", async () => {
    const result = await check("/ok");

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result).not.toHaveProperty("error");
  });

  it("is down when it does not, and names the text expected, never the body", async () => {
    const result = await check("/sick");

    expect(result).toMatchObject({
      ok: false,
      status: 200,
      error: `body does not contain: ${HEALTHY}`,
    });
    expect(result?.hint).toContain("the service answers 200 without this exact text");
    expect(result?.hint).toContain("`contains` in .probe/config.yml");
    expect(JSON.stringify(result)).not.toContain("degraded");
  });

  it("finds a text that arrives in two pieces", async () => {
    expect(await check("/split")).toMatchObject({ ok: true });
  });

  it("does not wait for the end of a body that already holds the text", async () => {
    expect(await check("/early")).toMatchObject({ ok: true });
  });

  it("says so when the body is empty", async () => {
    const result = await check("/empty");

    expect(result).toMatchObject({ ok: false, status: 200 });
    expect(result?.hint).toContain("answers 200 with an empty body");
  });

  it("reports a timeout when the body never ends", async () => {
    expect(await check("/stalled")).toMatchObject({ ok: false, error: "timeout after 0.3s" });
  });

  it("stops reading after the limit", async () => {
    const result = await check("/big", { timeout: 5 });

    expect(result).toMatchObject({ ok: false, status: 200 });
    expect(result?.hint).toContain("not in the first 1 MiB of the body");
  });

  it("judges the status first", async () => {
    expect(await check("/boom")).toMatchObject({ ok: false, error: "expected 2xx, got 500" });
  });

  it("shortens a long text in the error", async () => {
    const result = await check("/ok", { contains: "x".repeat(100) });

    expect(result?.error).toBe(`body does not contain: ${"x".repeat(39)}…`);
  });

  it("gives way to the hint of the service", async () => {
    const result = await check("/sick", { hint: "run: make api" });

    expect(result).toMatchObject({ error: `body does not contain: ${HEALTHY}` });
    expect(result?.hint).toBe("run: make api");
  });

  it.each([
    ["/ok", true, `{${HEALTHY}}`],
    ["/sick", false, '{"status":"degraded"}'],
  ])("still shows the body of %s in the detail", async (path, ok, body) => {
    const result = await check(path, {}, true);

    expect(result).toMatchObject({ ok, response: { body } });
  });
});

function probe(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    child.stdin.end();
  });
}

async function project(): Promise<string> {
  const root = await tempDir();
  await probe(root, ["init"]);
  return root;
}

const configText = (root: string) => readFile(join(root, ".probe", "config.yml"), "utf8");
const add = (root: string, name: string, path: string, ...more: string[]) =>
  probe(root, ["add", name, "-p", String(port), "--host", "127.0.0.1", "--path", path, ...more]);

describe("probe add --contains", () => {
  it("writes the text, then checks the body with it", async () => {
    const root = await project();

    expect((await add(root, "api", "/ok", "--contains", HEALTHY)).code).toBe(0);
    await add(root, "worker", "/sick", "--contains", HEALTHY);
    const text = await probe(root, ["check"]);
    const json = await probe(root, ["check", "--json"]);
    const list = await probe(root, ["ls"]);

    expect(text.code).toBe(1);
    expect(text.stdout).toMatch(/✓ api.*200/);
    expect(text.stdout).toMatch(new RegExp(`✗ worker.*body does not contain: ${HEALTHY}`));
    const [api, worker] = JSON.parse(json.stdout);
    expect(api).toMatchObject({ ok: true, status: 200 });
    expect(worker).toMatchObject({
      ok: false,
      status: 200,
      error: `body does not contain: ${HEALTHY}`,
    });
    expect(json.stdout).not.toContain("degraded");
    expect(list.stdout).toMatch(new RegExp(`api.*contains ${HEALTHY}`));
  });

  it("reads back from the config the text it wrote", async () => {
    const root = await project();
    await add(root, "api", "/ok", "--contains", HEALTHY);

    const again = await probe(root, ["check", "api"]);

    expect(await configText(root)).toContain(`contains: '${HEALTHY}'`);
    expect(again.code).toBe(0);
  });

  it.each(["", "a\nb"])("refuses %j, writing nothing", async (contains) => {
    const root = await project();
    const before = await configText(root);

    const run = await add(root, "api", "/ok", "--contains", contains);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--contains expects one line of text");
    expect(await configText(root)).toBe(before);
  });

  it("names the key in the error of a config that sets it with HEAD", async () => {
    const root = await project();
    await writeFile(
      join(root, ".probe", "config.yml"),
      `schemaVersion: 1\nservices:\n  api:\n    port: ${port}\n    method: HEAD\n    contains: ok\n`,
    );

    const run = await probe(root, ["check"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("services.api.contains");
    expect(run.stderr).toContain("HEAD");
  });
});
