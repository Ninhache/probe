import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { diagnoseStatus } from "../src/checkers/diagnosis";
import { curlCommand, curlNote, httpChecker } from "../src/checkers/http";
import {
  hiddenHeaderLine,
  isSensitiveHeader,
  MASK,
  masked,
  parseHeaderLine,
  resolveHeaders,
  serviceVariables,
  splitSecret,
} from "../src/config/headers";
import { loadVariables, readLocalVariables, writeVariable } from "../src/config/local";
import { formatIssues } from "../src/config/migrations";
import { type Service, serviceSchemaV1 } from "../src/config/schema";
import { tempProject } from "./helpers";

const SECRET = "s3cret-value";
const lookup = (values: Record<string, string>) => (name: string) => values[name];

function issues(headers: unknown): string {
  const result = serviceSchemaV1.safeParse({ port: 3000, headers });
  return result.success ? "" : formatIssues(result.error);
}

describe("headers in the config", () => {
  it("keeps the headers as written, a number or a boolean as its text", () => {
    const service = serviceSchemaV1.parse({
      port: 3000,
      headers: { Accept: "application/json", "X-Version": 2, "X-Debug": true },
    });

    expect(service.headers).toEqual({
      Accept: "application/json",
      "X-Version": "2",
      "X-Debug": "true",
    });
  });

  it.each(["Authorization", "Cookie", "X-Api-Key", "X-Auth-Token", "Proxy-Authorization"])(
    "refuses a value written as is for %s, without repeating it",
    (name) => {
      const said = issues({ [name]: `Bearer ${SECRET}` });

      expect(said).toContain(`headers.${name}: expected a reference instead of the secret`);
      expect(said).not.toContain(SECRET);
    },
  );

  it("accepts a secret given as a reference", () => {
    expect(issues({ Authorization: "Bearer ${API_TOKEN}", "X-Api-Key": "${API_KEY}" })).toBe("");
  });

  it("refuses the same header twice under another case", () => {
    expect(issues({ accept: "a", Accept: "b" })).toContain(
      "headers.Accept: declared twice, also as accept",
    );
  });

  it.each([
    [{ "Bad Name": "x" }, "expected a header name"],
    [{ "Content-Length": "3" }, "a request without a body"],
    [{ Accept: "a\nb" }, "a value on one line"],
    [{ Accept: "${not a name}" }, "a variable name between braces"],
    [{ Accept: "${}" }, "a variable name between braces"],
  ])("refuses %j", (headers, reason) => {
    expect(issues(headers)).toContain(reason);
  });

  it("knows a secret by the name of its header, listed or not", () => {
    expect(isSensitiveHeader("X-Session-Id")).toBe(true);
    expect(isSensitiveHeader("Accept")).toBe(false);
  });
});

describe("resolveHeaders", () => {
  const templates = { Authorization: "Bearer ${API_TOKEN}", "X-Tenant": "${TENANT}-${TENANT}" };

  it("puts the value of each variable in the headers", () => {
    expect(resolveHeaders(templates, lookup({ API_TOKEN: SECRET, TENANT: "acme" }))).toEqual({
      headers: [
        ["Authorization", `Bearer ${SECRET}`],
        ["X-Tenant", "acme-acme"],
      ],
      secrets: [SECRET, "acme"],
    });
  });

  it("names every variable nothing sets, an empty one included", () => {
    expect(resolveHeaders(templates, lookup({ TENANT: "" }))).toEqual({
      unset: ["API_TOKEN", "TENANT"],
    });
  });

  it("names a variable whose value has a line break, not the value", () => {
    expect(resolveHeaders(templates, lookup({ API_TOKEN: "a\nb", TENANT: "acme" }))).toEqual({
      unsendable: ["API_TOKEN"],
    });
  });

  it("does not read a value as a template", () => {
    const resolved = resolveHeaders({ "X-Api-Key": "${A}" }, lookup({ A: "${B}", B: "no" }));

    expect(resolved).toMatchObject({ headers: [["X-Api-Key", "${B}"]] });
  });

  it("lists the variables of a service once each", () => {
    expect(serviceVariables(templates)).toEqual(["API_TOKEN", "TENANT"]);
    expect(serviceVariables(undefined)).toEqual([]);
  });
});

describe("masked", () => {
  it("hides every secret, the longest first", () => {
    expect(masked("token=abcdef, short=abcd", ["abcd", "abcdef"])).toBe(
      `token=${MASK}, short=${MASK}`,
    );
  });
});

describe("a secret typed in a header", () => {
  it("sets apart a scheme of the list only, whatever the case", () => {
    expect(splitSecret("Bearer abc")).toEqual({ scheme: "Bearer ", secret: "abc" });
    expect(splitSecret("basic  abc")).toEqual({ scheme: "basic  ", secret: "abc" });
    expect(splitSecret("Custom abc")).toEqual({ scheme: "", secret: "Custom abc" });
    expect(splitSecret("Bearer")).toEqual({ scheme: "", secret: "Bearer" });
  });

  it("hides what follows the scheme, and nothing of an ordinary header", () => {
    expect(hiddenHeaderLine("Authorization: Bearer abc", "*")).toBe("Authorization: Bearer ***");
    expect(hiddenHeaderLine("X-Api-Key:abc", "*")).toBe("X-Api-Key:***");
    expect(hiddenHeaderLine("Cookie: a b", "*")).toBe("Cookie: ***");
    expect(hiddenHeaderLine("Accept: text/plain", "*")).toBe("Accept: text/plain");
    expect(hiddenHeaderLine("Authoriz", "*")).toBe("Authoriz");
  });

  it("shows a reference as typed", () => {
    const line = "Authorization: Bearer $" + "{API_TOKEN}";

    expect(hiddenHeaderLine(line, "*")).toBe(line);
  });

  it("keeps hidden a secret followed by a reference, closed or not", () => {
    const open = "$" + "{";

    expect(hiddenHeaderLine(`X-Api-Key: abc${open}`, "*")).toBe("X-Api-Key: *****");
    expect(hiddenHeaderLine(`X-Api-Key: abc${open}KEY`, "*")).toBe("X-Api-Key: ********");
    expect(hiddenHeaderLine(`X-Api-Key: abc${open}KEY}`, "*")).toBe(`X-Api-Key: ***${open}KEY}`);
    expect(hiddenHeaderLine(`X-Api-Key: ${open}a b}`, "*")).toBe("X-Api-Key: ******");
  });
});

describe("parseHeaderLine", () => {
  it("splits at the first colon", () => {
    expect(parseHeaderLine("X-Url:  http://a:1 ")).toEqual(["X-Url", "http://a:1"]);
    expect(parseHeaderLine("no colon")).toBeUndefined();
    expect(parseHeaderLine(": x")).toBeUndefined();
  });
});

describe("curlCommand with headers", () => {
  const withHeaders = (headers: Record<string, string>): Service => ({
    host: "localhost",
    port: 3000,
    path: "/",
    headers,
  });

  it("writes a variable as a reference for the shell, and does not follow redirects", () => {
    expect(curlCommand(withHeaders({ Authorization: "Bearer ${API_TOKEN}" }))).toBe(
      `curl -i --max-time 3 -H "Authorization: Bearer $API_TOKEN" 'http://localhost:3000/'`,
    );
  });

  it("keeps the braces where the name would run into what follows", () => {
    expect(curlCommand(withHeaders({ "X-Key": "${A}_x" }))).toContain(`-H "X-Key: \${A}_x"`);
  });

  it("quotes a header without variable as is", () => {
    expect(curlCommand(withHeaders({ Accept: "it's $HOME" }))).toContain(
      `-H 'Accept: it'\\''s $HOME'`,
    );
  });

  it("keeps what the shell would read out of the double quotes", () => {
    expect(curlCommand(withHeaders({ "X-Key": 'a"`b ${K}' }))).toContain(`-H 'X-Key: a"\`b '"$K"`);
  });

  it("still follows redirects for a service without headers", () => {
    expect(curlCommand({ host: "localhost", port: 3000, path: "/" })).toBe(
      "curl -i -L --max-time 3 'http://localhost:3000/'",
    );
  });

  it("says which variables the shell must have", () => {
    const service = withHeaders({ Authorization: "${A} ${B}" });

    expect(curlNote(service, { A: "set" })).toBe(
      "it reads B from the shell that runs it: export it there first",
    );
    expect(curlNote(service, { A: "set", B: "set" })).toBeUndefined();
    expect(curlNote(withHeaders({ Accept: "x" }), {})).toBeUndefined();
  });
});

describe("a refused request", () => {
  const plain: Service = { host: "localhost", port: 3000, path: "/" };

  it.each([401, 403])("suggests headers on %i when none are sent", (status) => {
    expect(diagnoseStatus(plain, status).hint).toBe(
      "the service asks for credentials: give it `headers` in .probe/config.yml",
    );
  });

  it("points at the variables sent when there are some", () => {
    const hint = diagnoseStatus({ ...plain, headers: { Authorization: "${API_TOKEN}" } }, 401).hint;

    expect(hint).toContain("the service refuses what is sent");
    expect(hint).toContain("API_TOKEN");
  });
});

describe("variables in local.yml", () => {
  it("reads the environment first, then local.yml; an empty value sets nothing", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(paths.local, "variables:\n  A: local-a\n  B: local-b\n  N: 42\n  E: ''\n");

    const { lookup: read, localUnreadable } = await loadVariables(paths, { A: "env-a", B: "" });

    expect([read("A"), read("B"), read("N"), read("E"), read("X")]).toEqual([
      "env-a",
      "local-b",
      "42",
      undefined,
      undefined,
    ]);
    expect(localUnreadable).toBeUndefined();
  });

  it("says when local.yml cannot be read", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(paths.local, "variables: [unclosed\n");

    expect(await loadVariables(paths, {})).toMatchObject({ localUnreadable: true });
    expect(await writeVariable(paths, "A", "x")).toBe(false);
  });

  it("keeps a value in an owner-only file, beside what is already there", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(paths.local, "# mine\ndashboard:\n  interval: 5\n", { mode: 0o644 });

    expect(await writeVariable(paths, "API_TOKEN", SECRET)).toBe(true);
    // Made by hand and readable by all: not once it holds a secret.
    expect((await stat(paths.local)).mode & 0o777).toBe(0o600);
    expect(await writeVariable(paths, "OTHER", "1234")).toBe(true);

    expect(await readFile(paths.local, "utf8")).toBe(
      `# mine\ndashboard:\n  interval: 5\nvariables:\n  API_TOKEN: ${SECRET}\n  OTHER: "1234"\n`,
    );
    expect((await readLocalVariables(paths)).values).toEqual({ API_TOKEN: SECRET, OTHER: "1234" });
  });

  it("creates local.yml readable by its owner only", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");

    await writeVariable(paths, "API_TOKEN", SECRET);

    expect((await stat(paths.local)).mode & 0o777).toBe(0o600);
  });

  it("forgets a value, and the section with the last one", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeVariable(paths, "A", "value-a");

    expect(await writeVariable(paths, "A", undefined)).toBe(true);

    expect(await readFile(paths.local, "utf8")).toBe("");
  });
});

describe("http checker with headers", () => {
  let server: Server;
  let elsewhere: Server;
  let port: number;
  let foreign: string;
  let seenElsewhere: IncomingHttpHeaders[] = [];
  let requests = 0;

  beforeAll(async () => {
    elsewhere = createServer((request, response) => {
      seenElsewhere.push(request.headers);
      response.writeHead(200).end("login page");
    });
    await new Promise<void>((done) => elsewhere.listen(0, "127.0.0.1", done));
    // Same machine, another origin: `localhost` is not `127.0.0.1`.
    foreign = `http://localhost:${(elsewhere.address() as AddressInfo).port}`;

    server = createServer((request, response) => {
      requests += 1;
      const key = request.headers["x-api-key"];
      switch (request.url) {
        case "/hop":
          response.writeHead(302, { location: "/private" }).end();
          break;
        case "/moved":
          response.writeHead(301, { location: foreign.replace("localhost", "127.0.0.1") }).end();
          break;
        case "/away":
          response.writeHead(302, { location: `${foreign}/login` }).end();
          break;
        case "/loop":
          response.writeHead(302, { location: "/loop" }).end();
          break;
        case "/echo":
          response.writeHead(200, "OK", { "x-seen": `key ${key}` }).end(`you sent ${key}`);
          break;
        default:
          response.writeHead(key === SECRET ? 200 : 401).end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
    elsewhere.close();
  });

  beforeEach(() => {
    requests = 0;
    seenElsewhere = [];
  });

  const variables = { lookup: lookup({ API_KEY: SECRET }) };
  const check = (path: string, context: object = { variables }, more: Partial<Service> = {}) =>
    httpChecker.check(
      "api",
      { host: "127.0.0.1", port, path, headers: { "X-Api-Key": "${API_KEY}" }, ...more },
      { timeoutMs: 2_000, ...context },
    );

  it("sends the headers with the value of their variables", async () => {
    expect(await check("/private")).toMatchObject({ ok: true, status: 200 });
  });

  it("sends nothing when a variable is not set", async () => {
    const result = await check("/private", {});

    expect(result).toMatchObject({
      ok: false,
      latencyMs: 0,
      error: "API_KEY is not set",
      hint: "set it for this machine: probe var API_KEY (or export it)",
    });
    expect(result.status).toBeUndefined();
    expect(requests).toBe(0);
  });

  it("says local.yml is broken rather than the variable missing", async () => {
    const result = await check("/private", {
      variables: { lookup: () => undefined, localUnreadable: true },
    });

    expect(result.hint).toBe(".probe/local.yml is not valid YAML: fix it, or export API_KEY");
  });

  it("sends nothing, and shows nothing, when a value cannot go in a header", async () => {
    const result = await check("/private", { variables: { lookup: () => `${SECRET}\nx` } });

    expect(result).toMatchObject({ ok: false, error: "API_KEY cannot go in a header" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(requests).toBe(0);
  });

  it("follows a redirect on the same origin, headers included", async () => {
    expect(await check("/hop")).toMatchObject({ ok: true, status: 200 });
  });

  it("stops at a redirect to another origin, which gets no request", async () => {
    const result = await check("/away");

    expect(result).toMatchObject({
      ok: false,
      status: 302,
      error: `redirected to ${foreign}`,
    });
    expect(result.hint).toContain("headers stay on the host they are for");
    expect(seenElsewhere).toEqual([]);
  });

  it("says the address moved when the redirect stays on the same host", async () => {
    const moved = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
    const result = await httpChecker.check(
      "api",
      { host: "127.0.0.1", port, path: "/moved", headers: { "X-Api-Key": "${API_KEY}" } },
      { timeoutMs: 2_000, variables },
    );

    expect(result).toMatchObject({ ok: false, error: `redirected to ${moved}` });
    expect(result.hint).toContain("set `url` to it in .probe/config.yml");
    expect(seenElsewhere).toEqual([]);
  });

  it("takes an expected redirect as it comes, wherever it leads", async () => {
    expect(await check("/away", { variables }, { expect: 302 })).toMatchObject({
      ok: true,
      status: 302,
    });
    expect(seenElsewhere).toEqual([]);
  });

  it("gives up on a redirect that never ends", async () => {
    expect(await check("/loop")).toMatchObject({ ok: false, error: "too many redirects" });
  });

  it("hides the secret a service repeats in its response", async () => {
    const { response } = await check("/echo", { variables, detail: true });

    expect(JSON.stringify(response)).not.toContain(SECRET);
    expect(response?.body).toBe(`you sent ${MASK}`);
    expect(response?.headers).toContainEqual(["x-seen", `key ${MASK}`]);
  });

  it("still follows any redirect for a service without headers", async () => {
    const result = await httpChecker.check(
      "api",
      { host: "127.0.0.1", port, path: "/away" },
      { timeoutMs: 2_000 },
    );

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(seenElsewhere).toHaveLength(1);
  });
});
