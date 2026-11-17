import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { targetUrl } from "../src/checkers/http";
import { selectionFrom as selectionFromArgs } from "../src/commands/shared";
import { applySelection, selectionFrom } from "../src/config/parameters";
import { type Config, configSchemaV1, type Service } from "../src/config/schema";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

const TENANT = { values: ["acme", "globex"], strategy: { kind: "header", name: "X-Tenant" } };
const VERSION = { values: ["v1", "v2"], strategy: { kind: "path" } };
const ENV = { values: ["local", "prod"], strategy: { kind: "url" } };
const REGION = { values: ["eu", "us"], strategy: { kind: "query", name: "region" } };

const parsed = (parameters: unknown, services: unknown = { api: { port: 3000 } }): Config =>
  configSchemaV1.parse({ schemaVersion: 1, parameters, services });

const refused = (parameters: unknown): string => {
  const result = configSchemaV1.safeParse({ schemaVersion: 1, parameters, services: {} });
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join("\n");
};

describe("the parameters of a config", () => {
  it("are absent from a config that declares none", () => {
    expect(configSchemaV1.parse({ schemaVersion: 1, services: {} }).parameters).toBeUndefined();
  });

  it("may be left empty", () => {
    expect(configSchemaV1.parse({ schemaVersion: 1, parameters: null, services: {} })).toEqual({
      schemaVersion: 1,
      parameters: null,
      services: {},
    });
  });

  it("read numbers as values", () => {
    const { parameters } = parsed({ version: { values: [1, "2.1"], strategy: { kind: "path" } } });

    expect(parameters?.version?.values).toEqual(["1", "2.1"]);
  });

  it.each([
    ["no value", { tenant: { ...TENANT, values: [] } }],
    ["a value twice", { tenant: { ...TENANT, values: ["acme", "acme"] } }],
    ["a value with a comma", { version: { ...VERSION, values: ["v1,v2"] } }],
    ["a value with a space around it", { version: { ...VERSION, values: [" v1"] } }],
    ["a value on two lines", { version: { ...VERSION, values: ["v1\nv2"] } }],
    ["an accent in a header", { tenant: { ...TENANT, values: ["créteil"] } }],
    ["a variable in a header", { tenant: { ...TENANT, values: [`$\{API_TOKEN}`] } }],
    ["a name with a space", { "my tenant": TENANT }],
    ["an unknown strategy", { tenant: { ...TENANT, strategy: { kind: "script" } } }],
    ["a header without a name", { tenant: { ...TENANT, strategy: { kind: "header" } } }],
    ["a query without a name", { region: { ...REGION, strategy: { kind: "query" } } }],
    ["a path with a name", { version: { ...VERSION, strategy: { kind: "path", name: "v" } } }],
    ["an unknown key", { tenant: { ...TENANT, default: "acme" } }],
    ["no strategy", { tenant: { values: ["acme"] } }],
    [
      "two parameters on one header, whatever the case",
      { tenant: TENANT, client: { ...TENANT, strategy: { kind: "header", name: "x-tenant" } } },
    ],
    ["two parameters on one query", { region: REGION, zone: REGION }],
    ["two url parameters", { env: ENV, stage: ENV }],
    ["a url with a name", { env: { ...ENV, strategy: { kind: "url", name: "x" } } }],
  ])("refuse %s", (_what, parameters) => {
    expect(refused(parameters)).not.toBe("");
  });

  it("take any text on one line as a value of a query or a path", () => {
    const { parameters } = parsed({
      city: { ...REGION, values: ["new york", "créteil", "a/b"] },
      tenant: { ...TENANT, values: ["acme & co"] },
    });

    expect(parameters?.city?.values).toEqual(["new york", "créteil", "a/b"]);
  });

  it("refuse a header that carries a secret, without repeating a value", () => {
    const message = refused({
      token: { values: ["s3cr3t"], strategy: { kind: "header", name: "Authorization" } },
    });

    expect(message).toContain("expected a header that carries no secret");
    expect(message).not.toContain("s3cr3t");
  });
});

describe("two parameters", () => {
  it("may share a name when one is a header and the other a query", () => {
    const shared = { values: ["eu"], strategy: { kind: "query", name: "X-Tenant" } };

    expect(refused({ tenant: TENANT, region: shared })).toBe("");
  });

  it("may be several paths", () => {
    expect(refused({ version: VERSION, area: VERSION })).toBe("");
  });
});

describe("the urls of a service", () => {
  const issues = (parameters: unknown, urls: unknown): string => {
    const services = { api: { port: 3000, urls } };
    const result = configSchemaV1.safeParse({ schemaVersion: 1, parameters, services });
    return result.success ? "" : result.error.issues.map((issue) => issue.message).join("\n");
  };

  it("are one address for a value of the url parameter", () => {
    expect(issues({ env: ENV }, { prod: "https://api.example.com/health" })).toBe("");
  });

  it("refuse a value the parameter does not list", () => {
    expect(issues({ env: ENV }, { staging: "https://api.example.com" })).toContain(
      "expected a value of the parameter: local, prod",
    );
  });

  it("need a url parameter", () => {
    expect(issues({ tenant: TENANT }, { prod: "https://api.example.com" })).toContain(
      "needs a parameter with `strategy: { kind: url }`",
    );
    expect(issues(undefined, { prod: "https://api.example.com" })).not.toBe("");
  });

  it("refuse an address with a password, without repeating it", () => {
    const message = issues({ env: ENV }, { prod: "https://me:hunter2@api.example.com" });

    expect(message).toContain("a URL without a user or a password");
    expect(message).not.toContain("hunter2");
  });
});

describe("selectionFrom", () => {
  const config = parsed({ tenant: TENANT, version: VERSION });

  it("keeps what is asked for", () => {
    expect(selectionFrom(config, ["tenant=globex", "version=v2"])).toEqual({
      tenant: "globex",
      version: "v2",
    });
  });

  it("keeps the last value given to a parameter", () => {
    expect(selectionFrom(config, ["tenant=globex", "tenant=acme"])).toEqual({ tenant: "acme" });
  });

  it.each([
    [["tenant"], /--set expects name=value/],
    [["tenant="], /--set expects name=value/],
    [["=globex"], /--set expects name=value/],
    [["region=eu"], /unknown parameter: region\. Known: tenant, version\./],
    [["tenant=nope"], /unknown value for tenant: nope\. Known: acme, globex\./],
  ])("refuses %j", (pairs, message) => {
    expect(() => selectionFrom(config, pairs)).toThrow(message);
  });

  it("names no parameter in a config that has none", () => {
    expect(() => selectionFrom(parsed(undefined), ["tenant=globex"])).toThrow(
      /unknown parameter: tenant\. Known: \(none\)\./,
    );
  });

  it("reads every --set of a command line", () => {
    const rawArgs = ["api", "--set", "tenant=globex", "--json", "--set=version=v2"];

    expect(selectionFromArgs(config, rawArgs)).toEqual({ tenant: "globex", version: "v2" });
  });
});

describe("applySelection", () => {
  const services = {
    api: { port: 3000, path: "/health" },
    web: { url: "https://example.com/status?full=1" },
    root: { port: 8080 },
  };
  const rewritten = (parameters: unknown, selection = {}, declared: unknown = services) =>
    applySelection(parsed(parameters, declared), selection).services;

  it("returns the config itself when it declares no parameter", () => {
    const config = parsed(undefined);

    expect(applySelection(config)).toBe(config);
  });

  it("sends the first value of a header parameter by default", () => {
    const { api, web } = rewritten({ tenant: TENANT });

    expect(api?.headers).toEqual({ "X-Tenant": "acme" });
    expect(web?.headers).toEqual({ "X-Tenant": "acme" });
    expect(web?.url).toBe("https://example.com/status?full=1");
  });

  it("encodes in the URL what it cannot carry as it is", () => {
    const city = { ...REGION, values: ["new york"] };
    const place = { ...VERSION, values: ["créteil/sud"] };

    const { api } = rewritten({ city, place });

    expect(api?.path).toBe("/cr%C3%A9teil%2Fsud/health?region=new%20york");
  });

  it("sends the value asked for", () => {
    expect(rewritten({ tenant: TENANT }, { tenant: "globex" }).api?.headers).toEqual({
      "X-Tenant": "globex",
    });
  });

  it("keeps the header a service declares itself, whatever its case", () => {
    const { api } = rewritten(
      { tenant: TENANT },
      {},
      {
        api: { port: 3000, headers: { "x-tenant": "own", Accept: "text/plain" } },
      },
    );

    expect(api?.headers).toEqual({ "x-tenant": "own", Accept: "text/plain" });
  });

  it("puts a path parameter before the path of the service", () => {
    const { api, web, root } = rewritten({ version: VERSION }, { version: "v2" });

    expect(api).toMatchObject({ host: "localhost", port: 3000, path: "/v2/health" });
    expect(api?.url).toBeUndefined();
    expect(web).toMatchObject({
      url: "https://example.com/v2/status?full=1",
      path: "/v2/status?full=1",
    });
    expect(root?.path).toBe("/v2");
  });

  it("adds a query parameter after the query of the service", () => {
    const { api, web } = rewritten({ region: REGION }, { region: "us" });

    expect(api?.path).toBe("/health?region=us");
    expect(web?.url).toBe("https://example.com/status?full=1&region=us");
  });

  it("keeps the query a service declares itself", () => {
    const { api } = rewritten(
      { region: REGION },
      {},
      {
        api: { port: 3000, path: "/health?region=asia" },
      },
    );

    expect(api?.path).toBe("/health?region=asia");
  });

  it("leaves the query of a service as it is written", () => {
    const { api } = rewritten(
      { region: REGION },
      {},
      {
        api: { port: 3000, path: "/find?q=a%20b" },
      },
    );

    expect(api?.path).toBe("/find?q=a%20b&region=eu");
  });

  it("applies every parameter, the paths in the order they are declared", () => {
    const { api } = rewritten({
      tenant: TENANT,
      version: VERSION,
      stage: { values: ["beta"], strategy: { kind: "path" } },
      region: REGION,
    });

    expect(api).toMatchObject({
      path: "/v1/beta/health?region=eu",
      headers: { "X-Tenant": "acme" },
    });
  });

  it("requests the address a service gives for the chosen value", () => {
    const config = parsed(
      { env: ENV },
      {
        api: { port: 3000, path: "/health", urls: { prod: "https://api.example.com/live?a=1" } },
        db: { port: 5432 },
      },
    );

    const local = applySelection(config).services;
    const prod = applySelection(config, { env: "prod" }).services;

    expect(targetUrl(local.api as Service)).toBe("http://localhost:3000/health");
    expect(targetUrl(prod.api as Service)).toBe("https://api.example.com/live?a=1");
    expect(prod.api).toMatchObject({ host: "api.example.com", port: 443, path: "/live?a=1" });
    expect(targetUrl(prod.db as Service)).toBe("http://localhost:5432/");
  });

  it("applies the other parameters to that address", () => {
    const config = parsed(
      { env: ENV, version: VERSION, tenant: TENANT },
      { api: { port: 3000, urls: { prod: "https://api.example.com/live" } } },
    );

    const { api } = applySelection(config, { env: "prod", version: "v2" }).services;

    expect(targetUrl(api as Service)).toBe("https://api.example.com/v2/live");
    expect(api?.headers).toEqual({ "X-Tenant": "acme" });
  });

  it("does not change the config it is given", () => {
    const config = parsed({ tenant: TENANT, version: VERSION }, services);
    const before = structuredClone(config);

    applySelection(config, { tenant: "globex" });

    expect(config).toEqual(before);
  });
});

interface Received {
  url: string;
  tenant: string | undefined;
}

let server: Server;
let port: number;
let received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    received.push({
      url: request.url ?? "",
      tenant: request.headers["x-tenant"] as string | undefined,
    });
    response.writeHead(200).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

beforeEach(() => {
  received = [];
});

function probe(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
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

const PARAMETERS = `# who is asked
parameters:
  tenant:
    values: [acme, globex]
    strategy: { kind: header, name: X-Tenant }
  version: { values: [v1, v2], strategy: { kind: path } }
  region: { values: [eu, us], strategy: { kind: query, name: region } }
`;

const configFile = (root: string) => join(root, ".probe", "config.yml");

async function project(parameters = PARAMETERS): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".probe"));
  await writeFile(
    configFile(root),
    `schemaVersion: 1\n${parameters}services:\n  api: { host: 127.0.0.1, port: ${port}, path: /health }\n`,
  );
  return root;
}

describe("probe check with parameters", () => {
  it("requests the first value of each parameter by default", async () => {
    const root = await project();

    const run = await probe(root, ["check", "--json"]);

    expect(run.code).toBe(0);
    expect(received).toEqual([{ url: "/v1/health?region=eu", tenant: "acme" }]);
    expect(JSON.parse(run.stdout)[0].target).toBe(`http://127.0.0.1:${port}/v1/health?region=eu`);
  });

  it("requests the values given with --set", async () => {
    const root = await project();

    const run = await probe(root, [
      "check",
      "--set",
      "tenant=globex",
      "--set=version=v2",
      "--set",
      "region=us",
    ]);

    expect(run.code).toBe(0);
    expect(received).toEqual([{ url: "/v2/health?region=us", tenant: "globex" }]);
  });

  it("refuses a value the config does not list, requesting nothing", async () => {
    const root = await project();

    const run = await probe(root, ["check", "--set", "tenant=nope"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("unknown value for tenant: nope. Known: acme, globex.");
    expect(received).toEqual([]);
  });

  it("refuses --set in a config without parameters", async () => {
    const root = await project("");

    const run = await probe(root, ["check", "--set", "tenant=globex"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("unknown parameter: tenant. Known: (none).");
  });

  it("requests a config without parameters as before", async () => {
    const root = await project("");

    const run = await probe(root, ["check"]);

    expect(run.code).toBe(0);
    expect(received).toEqual([{ url: "/health", tenant: undefined }]);
  });
});

describe("the other commands with parameters", () => {
  it("wait requests the values given with --set", async () => {
    const root = await project();

    const run = await probe(root, ["wait", "--set", "tenant=globex", "--timeout", "5"]);

    expect(run.code).toBe(0);
    expect(received[0]).toEqual({ url: "/v1/health?region=eu", tenant: "globex" });
  });

  it("ls shows the URL that is requested", async () => {
    const root = await project();

    const listed = await probe(root, ["ls", "--set", "version=v2"]);

    expect(listed.stdout).toContain(`http://127.0.0.1:${port}/v2/health?region=eu`);
  });

  it("curl prints the header and the URL that are sent", async () => {
    const root = await project();

    const run = await probe(root, ["curl", "api", "--set", "tenant=globex"]);

    expect(run.stdout).toContain("-H 'X-Tenant: globex'");
    expect(run.stdout).toContain(`'http://127.0.0.1:${port}/v1/health?region=eu'`);
  });

  it("doctor requests the values given with --set", async () => {
    const root = await project();

    const run = await probe(root, ["doctor", "--set", "tenant=globex", "--json"]);

    expect(run.code).toBe(0);
    expect(received).toEqual([{ url: "/v1/health?region=eu", tenant: "globex" }]);
  });

  it("an environment has its own parameters", async () => {
    const root = await project();
    await mkdir(join(root, ".probe", "envs"));
    await writeFile(
      join(root, ".probe", "envs", "prod.yml"),
      `schemaVersion: 1\nparameters:\n  tenant: { values: [initech], strategy: { kind: header, name: X-Tenant } }\nservices:\n  api: { host: 127.0.0.1, port: ${port}, path: /live }\n`,
    );

    const run = await probe(root, ["check", "--env", "prod"]);
    const other = await probe(root, ["check", "--env", "prod", "--set", "tenant=globex"]);

    expect(run.code).toBe(0);
    expect(received).toEqual([{ url: "/live", tenant: "initech" }]);
    expect(other.code).toBe(2);
    expect(other.stderr).toContain("unknown value for tenant: globex. Known: initech.");
  });

  it.each([
    [["add", "db", "-p", "5432", "--set", "tenant=globex"]],
    [["rm", "api", "--yes", "--set=tenant=globex"]],
    [["--set", "tenant=globex"]],
  ])("%j refuses --set, changing nothing", async (args) => {
    const root = await project();
    const before = await readFile(configFile(root), "utf8");

    const run = await probe(root, args);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--set is read by ");
    expect(await readFile(configFile(root), "utf8")).toBe(before);
    expect(received).toEqual([]);
  });

  it("a header parameter keeps a redirect on the address of the service", async () => {
    const elsewhere = createServer((request, response) => {
      received.push({ url: request.url ?? "", tenant: request.headers["x-tenant"] as string });
      response.writeHead(200).end();
    });
    await new Promise<void>((done) => elsewhere.listen(0, "127.0.0.1", done));
    const away = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}/`;
    const leaving = createServer((_request, response) => {
      response.writeHead(302, { location: away }).end();
    });
    await new Promise<void>((done) => leaving.listen(0, "127.0.0.1", done));
    const root = await tempDir();
    await mkdir(join(root, ".probe"));
    const service = `services:\n  api: { host: 127.0.0.1, port: ${(leaving.address() as AddressInfo).port} }\n`;
    const tenant =
      "parameters:\n  tenant: { values: [acme], strategy: { kind: header, name: X-Tenant } }\n";

    await writeFile(configFile(root), `schemaVersion: 1\n${service}`);
    const without = await probe(root, ["check"]);
    await writeFile(configFile(root), `schemaVersion: 1\n${tenant}${service}`);
    const withHeader = await probe(root, ["check"]);
    leaving.close();
    elsewhere.close();

    expect(without.code).toBe(0);
    expect(withHeader.code).toBe(1);
    expect(withHeader.stdout).toContain("redirected to");
    expect(received).toEqual([{ url: "/", tenant: undefined }]);
  });

  it("check and doctor look at the address of the chosen value", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".probe"));
    await writeFile(
      configFile(root),
      `schemaVersion: 1\nparameters:\n  env: { values: [local, up], strategy: { kind: url } }\nservices:\n  api:\n    host: 127.0.0.1\n    port: 1\n    urls: { up: "http://127.0.0.1:${port}/live" }\n`,
    );

    const down = await probe(root, ["check"]);
    const up = await probe(root, ["check", "--set", "env=up"]);
    const doctor = await probe(root, ["doctor", "--set", "env=up"]);
    await probe(root, ["add", "db", "-p", "5432"]);

    expect(down.code).toBe(1);
    expect(up.code).toBe(0);
    expect(doctor.code).toBe(0);
    expect(received.map(({ url }) => url)).toEqual(["/live", "/live"]);
    expect(parse(await readFile(configFile(root), "utf8")).services.api.urls).toEqual({
      up: `http://127.0.0.1:${port}/live`,
    });
  });

  it("add and rm leave the parameters and their comment in the config", async () => {
    const root = await project();

    await probe(root, ["add", "db", "-p", "5432"]);
    await probe(root, ["rm", "db", "--yes"]);
    const text = await readFile(configFile(root), "utf8");

    expect(text).toContain("# who is asked\nparameters:\n  tenant:\n");
    expect(parse(text).parameters).toEqual(parse(PARAMETERS).parameters);
    expect(text).not.toContain("db:");
    expect(text).not.toContain("X-Tenant: acme");
    expect(text).toContain("path: /health }");
  });
});
