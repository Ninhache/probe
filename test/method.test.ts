import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { curlCommand, httpChecker } from "../src/checkers/http";
import { type Service, serviceSchemaV1 } from "../src/config/schema";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

let server: Server;
let port: number;
let seen: { method?: string; url?: string; length?: string }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({
      method: request.method,
      url: request.url,
      length: request.headers["content-length"],
    });
    if (request.url === "/moved") response.writeHead(302, { location: "/" }).end();
    else
      response
        .writeHead(request.url === "/only-post" && request.method !== "POST" ? 405 : 200)
        .end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

beforeEach(() => {
  seen = [];
});

const service = (over: Partial<Service> = {}): Service => ({
  host: "127.0.0.1",
  port,
  path: "/",
  ...over,
});
const check = (over: Partial<Service> = {}) =>
  httpChecker.check("api", service(over), { timeoutMs: 1_000, variables: { lookup: () => "v" } });

describe("the method of a service in the config", () => {
  it("is absent from a service that does not give one", () => {
    expect(serviceSchemaV1.parse({ port: 3000 })).not.toHaveProperty("method");
  });

  it("is read in capitals, however it was written", () => {
    expect(serviceSchemaV1.parse({ port: 3000, method: "patch" }).method).toBe("PATCH");
  });

  it.each(["TRACE", "CONNECT", "FETCH", "", 3])("refuses %j", (method) => {
    expect(serviceSchemaV1.safeParse({ port: 3000, method }).success).toBe(false);
  });
});

describe("a check with a method", () => {
  it("sends a GET when none is given", async () => {
    await check();

    expect(seen).toEqual([{ method: "GET", url: "/", length: undefined }]);
  });

  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const)(
    "sends a %s",
    async (method) => {
      expect(await check({ method })).toMatchObject({ ok: true, status: 200 });
      expect(seen.map((request) => request.method)).toEqual([method]);
    },
  );

  it("is up where only that method is accepted, and down with a hint otherwise", async () => {
    expect(await check({ path: "/only-post", method: "POST" })).toMatchObject({ ok: true });
    expect(await check({ path: "/only-post" })).toMatchObject({
      ok: false,
      status: 405,
      hint: "the service refuses GET there: check `method` in .probe/config.yml",
    });
  });

  it.each([undefined, { Accept: "text/plain" }])(
    "sends a POST once: the redirect is its answer (headers: %j)",
    async (headers) => {
      expect(await check({ path: "/moved", method: "POST", headers })).toMatchObject({
        ok: false,
        status: 302,
        hint: "a POST is sent once, redirects are not followed: check `path` in .probe/config.yml",
      });
      expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual(["POST /moved"]);
    },
  );

  it.each([undefined, { Accept: "text/plain" }])(
    "still follows a redirect with a HEAD (headers: %j)",
    async (headers) => {
      expect(await check({ path: "/moved", method: "HEAD", headers })).toMatchObject({
        ok: true,
        status: 200,
      });
      expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual(["HEAD /moved", "HEAD /"]);
    },
  );
});

describe("curlCommand with a method", () => {
  const url = "'http://localhost:3000/'";
  const local = (over: Partial<Service>) =>
    curlCommand({ host: "localhost", port: 3000, path: "/", ...over });

  it("writes nothing more for a GET", () => {
    expect(local({ method: "GET" })).toBe(`curl -i -L --max-time 3 ${url}`);
  });

  it("asks for the headers only with a HEAD, still following redirects", () => {
    expect(local({ method: "HEAD" })).toBe(`curl -I -L --max-time 3 ${url}`);
  });

  it("names the method and does not follow redirects", () => {
    expect(local({ method: "DELETE" })).toBe(`curl -i -X DELETE --max-time 3 ${url}`);
  });

  it.each(["POST", "PUT", "PATCH"] as const)("sends an empty body with a %s", (method) => {
    expect(local({ method })).toBe(
      `curl -i -X ${method} --max-time 3 -H 'Content-Length: 0' ${url}`,
    );
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

const config = (root: string) => readFile(join(root, ".probe", "config.yml"), "utf8");
const add = (root: string, ...more: string[]) =>
  probe(root, ["add", "hook", "-p", String(port), "--host", "127.0.0.1", ...more]);

describe("probe add --method", () => {
  it("writes the method in capitals, and checks with it", async () => {
    const root = await project();

    expect((await add(root, "--path", "/only-post", "-X", "post")).code).toBe(0);

    expect(await config(root)).toContain("method: POST");
    expect((await probe(root, ["check"])).code).toBe(0);
    expect(seen.at(-1)).toEqual({ method: "POST", url: "/only-post", length: "0" });
  });

  it("writes nothing for a GET", async () => {
    const root = await project();

    await add(root, "--method", "GET");

    expect(await config(root)).not.toContain("method");
  });

  it("refuses a method it does not know, writing nothing", async () => {
    const root = await project();
    const before = await config(root);

    const run = await add(root, "-X", "TRACE");

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      "--method expects one of GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS.",
    );
    expect(await config(root)).toBe(before);
  });
});

describe("a service with a method", () => {
  it("shows it in `probe ls` and in its curl command", async () => {
    const root = await project();
    await add(root, "-X", "DELETE");

    expect((await probe(root, ["ls"])).stdout).toMatch(/hook\s.*\sDELETE/);
    expect((await probe(root, ["curl", "hook"])).stdout).toBe(
      `curl -i -X DELETE --max-time 3 'http://127.0.0.1:${port}/'\n`,
    );
  });

  it("is refused with its name when the config gives an unknown method", async () => {
    const root = await project();
    await add(root, "-X", "POST");
    await writeFile(
      join(root, ".probe", "config.yml"),
      (await config(root)).replace("method: POST", "method: TRACE"),
    );

    const run = await probe(root, ["check"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("services.hook.method");
  });

  it("leaves `probe ls --json` as it was for a service without one", async () => {
    const root = await project();
    await probe(root, ["add", "web", "-p", "8080"]);

    expect((await probe(root, ["ls", "--json"])).stdout).not.toContain("method");
  });
});
