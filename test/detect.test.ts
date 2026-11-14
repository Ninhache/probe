import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DetectDeps, detectPorts, detectServices, systemDeps } from "../src/detect";
import { tempDir } from "./helpers";

const SECRET = "S3CRET";
const NO_PORTS: Pick<DetectDeps, "answers" | "ports"> = { answers: async () => false, ports: [] };

/** An example project made of `files`, searched with the real file reader. */
async function detectIn(
  files: Record<string, string>,
  existing = {},
  ports: Partial<DetectDeps> = {},
) {
  const root = await tempDir();
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text);
  return detectServices(root, existing, { ...systemDeps({}), ...NO_PORTS, ...ports });
}

describe("detectServices in .env", () => {
  it("should propose PORT as app", async () => {
    const found = await detectIn({ ".env": "PORT=4000\n" });

    expect(found).toEqual([{ name: "app", service: { port: 4000 }, source: ".env (PORT)" }]);
  });

  it("should propose a local http URL under the name of its key", async () => {
    const found = await detectIn({
      ".env": 'export VITE_API_URL="http://127.0.0.1:4000/health"\n',
    });

    expect(found).toEqual([
      {
        name: "api",
        service: { port: 4000, host: "127.0.0.1", path: "/health" },
        source: ".env (VITE_API_URL)",
      },
    ]);
  });

  it("should keep credentials, query strings and other values out of what it returns", async () => {
    const env = [
      `API_URL=http://user:${SECRET}@localhost:4000/health?token=${SECRET}`,
      `STRIPE_KEY=${SECRET}`,
      `DATABASE_URL=postgres://user:${SECRET}@localhost:5432/app`,
    ].join("\n");

    const found = await detectIn({ ".env": env });

    expect(found.map(({ name }) => name)).toEqual(["api"]);
    expect(JSON.stringify(found)).not.toContain(SECRET);
  });

  it("should ignore what an HTTP check cannot reach", async () => {
    const env =
      "SITE_URL=https://localhost:8443\nDOCS_URL=http://example.com\nREDIS_URL=http://localhost:6379\n";

    expect(await detectIn({ ".env": env })).toEqual([]);
  });
});

describe("detectServices in package.json", () => {
  it("should propose the port a script names, under the script name", async () => {
    const manifest = { name: "@acme/shop", scripts: { "dev:api": "tsx api.ts --port 4000" } };

    const found = await detectIn({ "package.json": JSON.stringify(manifest) });

    expect(found).toEqual([
      { name: "dev-api", service: { port: 4000 }, source: "package.json (dev:api script)" },
    ]);
  });

  it("should propose the usual port of the dev server, under the package name", async () => {
    const manifest = { name: "@acme/shop", scripts: { dev: "vite", build: "vite build" } };

    const found = await detectIn({ "package.json": JSON.stringify(manifest) });

    expect(found).toEqual([
      { name: "shop", service: { port: 5173 }, source: "package.json (dev script)" },
    ]);
  });

  it("should find nothing in a manifest that is not valid JSON", async () => {
    expect(await detectIn({ "package.json": "{" })).toEqual([]);
  });
});

describe("detectServices on local ports", () => {
  let server: Server;
  let port: number;
  let closedPort: number;

  beforeAll(async () => {
    server = createServer((_request, response) => response.writeHead(404).end());
    await new Promise<void>((done) => server.listen(0, "localhost", done));
    port = (server.address() as AddressInfo).port;
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "localhost", done));
    closedPort = (closed.address() as AddressInfo).port;
    await new Promise((done) => closed.close(done));
  });

  afterAll(() => new Promise((done) => server.close(done)));

  it("should propose a port where an HTTP server answers, whatever the status", async () => {
    const { answers } = systemDeps({});

    const found = await detectIn({}, {}, { answers, ports: [port, closedPort] });

    expect(found).toEqual([
      { name: `port-${port}`, service: { port }, source: `answers on localhost:${port}` },
    ]);
  });

  it("should not try a port a file already gave", async () => {
    const tried: number[] = [];
    const answers = async (candidate: number) => tried.push(candidate) > 0;

    const found = await detectIn({ ".env": "PORT=4000\n" }, {}, { answers, ports: [4000] });

    expect(tried).toEqual([]);
    expect(found).toHaveLength(1);
  });
});

describe("detectServices against the config", () => {
  it("should leave out a service that is already declared", async () => {
    const existing = { web: { port: 4000 } };

    expect(await detectIn({ ".env": "PORT=4000\n" }, existing)).toEqual([]);
  });

  it("should give a free name when the name is taken", async () => {
    const existing = { app: { port: 9000 } };

    const found = await detectIn({ ".env": "PORT=4000\n" }, existing);

    expect(found.map(({ name }) => name)).toEqual(["app-2"]);
  });
});

describe("detectPorts", () => {
  it("should try the usual ports when the variable is not set", () => {
    expect(detectPorts({})).toContain(3000);
  });

  it("should try none when the variable is empty", () => {
    expect(detectPorts({ PROBE_DETECT_PORTS: "" })).toEqual([]);
  });

  it("should try the listed ports", () => {
    expect(detectPorts({ PROBE_DETECT_PORTS: "4000, 4001,nope" })).toEqual([4000, 4001]);
  });
});
