import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectServices, type Machine, systemDeps } from "../src/detect";
import { answersHttp, detectPorts } from "../src/detect/sources/ports";
import { tempDir } from "./helpers";

const SECRET = "S3CRET";
const NO_PORTS: Machine = { answers: async () => false, ports: [] };

/** An example project made of `files`, searched with the real file reader. */
async function detectIn(
  files: Record<string, string>,
  existing = {},
  machine: Partial<Machine> = {},
) {
  const root = await tempDir();
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text);
  return detectServices(root, existing, { ...systemDeps({}), ...NO_PORTS, ...machine });
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

describe("detectServices in a compose file", () => {
  const COMPOSE = `
services:
  web:
    image: nginx
    ports:
      - "8080:80"
  api:
    build: .
    ports:
      - "127.0.0.1:\${API_PORT:-4000}:3000"
      - target: 9229
        published: "9229"
  db:
    image: postgres
    ports: ["5433:5432"]
  worker:
    image: busybox
  metrics:
    image: statsd
    ports: ["8125:8125/udp", "3000"]
`;

  it.each(["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"])(
    "should propose the published http ports of %s under the service names",
    async (file) => {
      const found = await detectIn({ [file]: COMPOSE });

      expect(found).toEqual([
        { name: "web", service: { port: 8080 }, source: `${file} (web service)` },
        { name: "api", service: { port: 4000 }, source: `${file} (api service)` },
        { name: "api-9229", service: { port: 9229 }, source: `${file} (api service)` },
      ]);
    },
  );

  it("should take the value of a variable from .env, and only that", async () => {
    const env = `API_PORT=4100\nSTRIPE_KEY=${SECRET}\n`;

    const found = await detectIn({ "compose.yml": COMPOSE, ".env": env });

    expect(found.find(({ name }) => name === "api")?.service).toEqual({ port: 4100 });
    expect(JSON.stringify(found)).not.toContain(SECRET);
  });

  it("should keep the compose name when .env gives the same port", async () => {
    const found = await detectIn({ "compose.yml": COMPOSE, ".env": "PORT=8080\n" });

    expect(found.filter(({ service }) => service.port === 8080).map(({ name }) => name)).toEqual([
      "web",
    ]);
  });

  it("should read the first compose file only, as docker compose does", async () => {
    const found = await detectIn({
      "compose.yaml": 'services: { web: { ports: ["8080:80"] } }',
      "docker-compose.yml": 'services: { old: { ports: ["8081:80"] } }',
    });

    expect(found.map(({ name }) => name)).toEqual(["web"]);
  });

  it("should add the ports of the override file", async () => {
    const found = await detectIn({
      "compose.yml": "services: { web: { image: nginx }, api: { ports: ['4000:4000'] } }",
      "compose.override.yml": 'services: { web: { ports: ["8080:80"] } }',
    });

    expect(found).toEqual([
      { name: "api", service: { port: 4000 }, source: "compose.yml (api service)" },
      { name: "web", service: { port: 8080 }, source: "compose.override.yml (web service)" },
    ]);
  });

  it("should not take variables from .env.local, which compose does not read", async () => {
    const found = await detectIn({
      "compose.yml": `services: { web: { ports: ["\${WEB_PORT:-8080}:80"] } }`,
      ".env.local": "WEB_PORT=9000\n",
    });

    expect(found.map(({ service }) => service.port)).toEqual([8080]);
  });

  it.each([
    [`\${WEB_PORT:-8080}`, 8080],
    [`\${WEB_PORT-8080}`, undefined],
  ])("should read %s with an empty WEB_PORT as port %s", async (port, expected) => {
    const found = await detectIn({
      "compose.yml": `services: { web: { ports: ["${port}:80"] } }`,
      ".env": "WEB_PORT=\n",
    });

    expect(found[0]?.service.port).toBe(expected);
  });

  it("should leave out a port published for https", async () => {
    const found = await detectIn({
      "compose.yml": 'services: { proxy: { ports: ["80:80", "443:443"] } }',
    });

    expect(found.map(({ service }) => service.port)).toEqual([80]);
  });

  it("should name a mail catcher after its web page, not its SMTP port", async () => {
    const found = await detectIn({
      "compose.yml": 'services: { mailer: { ports: ["1025:1025", "8025:8025"] } }',
    });

    expect(found).toEqual([
      { name: "mailer", service: { port: 8025 }, source: "compose.yml (mailer service)" },
    ]);
  });

  it("should follow a YAML merge key", async () => {
    const compose = 'x-web: &web\n  ports: ["8080:80"]\nservices:\n  web:\n    <<: *web\n';

    const found = await detectIn({ "compose.yml": compose });

    expect(found.map(({ name }) => name)).toEqual(["web"]);
  });

  it("should find nothing in a compose file that is not valid YAML", async () => {
    expect(await detectIn({ "compose.yml": "services: [" })).toEqual([]);
  });
});

describe("detectServices with a source of its own", () => {
  it("should apply the same rules to any source", async () => {
    const custom = {
      id: "custom",
      find: async () => [
        { name: "Bad Name!", service: { port: 4000 }, source: "custom" },
        { name: "db", service: { port: 5432 }, source: "custom" },
        { name: "ok", service: { port: 4001 }, source: "custom" },
        { name: "ok", service: { port: 4002 }, source: "custom" },
      ],
    };

    const found = await detectServices(
      "/nowhere",
      {},
      { ...NO_PORTS, read: async () => null, sources: [custom] },
    );

    expect(found.map(({ name }) => name)).toEqual(["ok", "ok-2"]);
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
    const found = await detectIn({}, {}, { answers: answersHttp, ports: [port, closedPort] });

    expect(found).toEqual([
      { name: `port-${port}`, service: { port }, source: `answers on localhost:${port}` },
    ]);
  });

  it("should propose a port that redirects, without following the redirect", async () => {
    let followed = 0;
    const target = createServer((_request, response) => {
      followed++;
      response.end();
    });
    await new Promise<void>((done) => target.listen(0, "localhost", done));
    const location = `http://localhost:${(target.address() as AddressInfo).port}/login`;
    const redirecting = createServer((_request, response) =>
      response.writeHead(302, { location }).end(),
    );
    await new Promise<void>((done) => redirecting.listen(0, "localhost", done));
    const redirectingPort = (redirecting.address() as AddressInfo).port;

    const found = await detectIn({}, {}, { answers: answersHttp, ports: [redirectingPort] });
    await new Promise((done) => redirecting.close(done));
    await new Promise((done) => target.close(done));

    expect(found.map(({ name }) => name)).toEqual([`port-${redirectingPort}`]);
    expect(followed).toBe(0);
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
