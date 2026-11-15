import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "s3cret-value";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function probe(
  cwd: string,
  args: string[],
  { stdin = "", env = {} }: { stdin?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", API_KEY: "", ...env },
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
    child.stdin.end(stdin);
  });
}

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(request.headers["x-api-key"] === SECRET ? 200 : 401).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

async function project(): Promise<string> {
  const root = await tempDir();
  await probe(root, ["init"]);
  return root;
}

const HEADER = "X-Api-Key: ${API_KEY}";
const addApi = (root: string) =>
  probe(root, ["add", "api", "-p", String(port), "--host", "127.0.0.1", "--header", HEADER]);
const config = (root: string) => readFile(join(root, ".probe", "config.yml"), "utf8");
const local = (root: string) => readFile(join(root, ".probe", "local.yml"), "utf8");

describe("probe add --header", () => {
  it("writes every header given, and says which variable to set next", async () => {
    const root = await project();

    const run = await probe(root, [
      "add",
      "api",
      "-p",
      String(port),
      "-H",
      HEADER,
      "--header=Accept: application/json",
      "-HX-Tenant: acme",
      "-H=X-Mode:dev",
    ]);

    expect(run).toMatchObject({
      code: 0,
      stdout: "Added api. It sends API_KEY, not set yet: probe var API_KEY\n",
    });
    expect(await config(root)).toContain(
      "headers:\n      X-Api-Key: ${API_KEY}\n      Accept: application/json\n      X-Tenant: acme\n      X-Mode: dev\n",
    );
  });

  it("refuses a secret written as is, without repeating it or writing anything", async () => {
    const root = await project();
    const before = await config(root);

    const run = await probe(root, ["add", "api", "-p", "3000", "-H", `X-Api-Key: ${SECRET}`]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--header X-Api-Key expects a reference instead of the secret");
    expect(run.stderr).toContain("config.yml is shared. Keep the single quotes around the header.");
    expect(run.stdout + run.stderr).not.toContain(SECRET);
    expect(await config(root)).toBe(before);
  });

  it.each([
    [["-H", "no colon"], '--header expects "Name: value"'],
    [["-H", "Bad Name: x"], "--header expects a header name"],
    [["-H", "Accept: a", "-H", "accept: b"], "--header gives accept twice"],
  ])("exits 2 on %j", async (flags, message) => {
    const root = await project();

    const run = await probe(root, ["add", "api", "-p", "3000", ...flags]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
  });
});

describe("a service with headers", () => {
  it("is down, with what to do, while its variable is not set", async () => {
    const root = await project();
    await addApi(root);

    const run = await probe(root, ["check", "--json"]);

    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject([
      {
        name: "api",
        ok: false,
        error: "API_KEY is not set",
        hint: "set it for this machine: probe var API_KEY (or export it)",
      },
    ]);
  });

  it("is up with the variable in the environment, whose value shows nowhere", async () => {
    const root = await project();
    await addApi(root);

    const plain = await probe(root, ["check"], { env: { API_KEY: SECRET } });
    const json = await probe(root, ["check", "--json"], { env: { API_KEY: SECRET } });

    expect(plain.code).toBe(0);
    expect(json.code).toBe(0);
    expect(plain.stdout + plain.stderr + json.stdout + json.stderr).not.toContain(SECRET);
    expect(await config(root)).not.toContain(SECRET);
  });

  it("is refused with a wrong value: the hint names the variable, not the value", async () => {
    const root = await project();
    await addApi(root);

    const run = await probe(root, ["check"], { env: { API_KEY: "wrong-value" } });

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("the service refuses what is sent: check API_KEY");
    expect(run.stdout + run.stderr).not.toContain("wrong-value");
  });

  it("makes `probe wait` fail at once rather than wait for a variable", async () => {
    const root = await project();
    await addApi(root);

    const run = await probe(root, ["wait", "--timeout", "30"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("api sends API_KEY, which is not set");
    expect(run.stderr).toContain("probe var API_KEY");
  });

  it("shows in `probe ls` by the names of its headers", async () => {
    const root = await project();
    await addApi(root);

    expect((await probe(root, ["ls"])).stdout).toContain("sends X-Api-Key");
  });

  it("gets a curl command that reads the variable from the shell", async () => {
    const root = await project();
    await addApi(root);

    const unset = await probe(root, ["curl", "api"]);
    const set = await probe(root, ["curl", "api"], { env: { API_KEY: SECRET } });

    expect(unset.stdout).toBe(
      `curl -i --max-time 3 -H "X-Api-Key: $API_KEY" 'http://127.0.0.1:${port}/'\n`,
    );
    expect(unset.stderr).toContain("it reads API_KEY from the shell that runs it");
    expect(set.stdout).toBe(unset.stdout);
    expect(set.stderr).toBe("");
  });

  it("keeps its headers when another service is removed", async () => {
    const root = await project();
    await addApi(root);
    await probe(root, ["add", "web", "-p", "8080"]);

    await probe(root, ["rm", "web", "--yes"]);

    expect(await config(root)).toContain("X-Api-Key: ${API_KEY}");
  });
});

describe("probe var", () => {
  it("keeps the value read on stdin in local.yml, never showing it", async () => {
    const root = await project();
    await addApi(root);

    const kept = await probe(root, ["var", "API_KEY"], { stdin: `${SECRET}\n` });
    const check = await probe(root, ["check"]);

    expect(kept).toMatchObject({
      code: 0,
      stdout: "Kept API_KEY in .probe/local.yml, for this machine only.\n",
      stderr: "",
    });
    expect(await local(root)).toBe(`variables:\n  API_KEY: ${SECRET}\n`);
    expect((await stat(join(root, ".probe", "local.yml"))).mode & 0o777).toBe(0o600);
    expect(check.code).toBe(0);
    expect(await config(root)).not.toContain(SECRET);
  });

  it("ignores local.yml in git before writing it, in a project that did not", async () => {
    const root = await project();
    await writeFile(join(root, ".gitignore"), "node_modules\n");

    await probe(root, ["var", "API_KEY"], { stdin: SECRET });

    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".probe/local.yml");
  });

  it("lists the variables and where they are set, never their value", async () => {
    const root = await project();
    await addApi(root);

    const before = await probe(root, ["var"]);
    await probe(root, ["var", "API_KEY"], { stdin: SECRET });
    const after = await probe(root, ["var"]);
    const exported = await probe(root, ["var"], { env: { API_KEY: SECRET } });

    expect(before.stdout).toBe("API_KEY  not set: probe var API_KEY  (sent by api)\n");
    expect(after.stdout).toBe("API_KEY  set in .probe/local.yml  (sent by api)\n");
    expect(exported.stdout).toBe("API_KEY  set in the environment  (sent by api)\n");
    expect(after.stdout + exported.stdout).not.toContain(SECRET);
  });

  it("forgets a value with --unset", async () => {
    const root = await project();
    await probe(root, ["var", "API_KEY"], { stdin: SECRET });

    const run = await probe(root, ["var", "API_KEY", "--unset"]);
    const again = await probe(root, ["var", "API_KEY", "--unset"]);

    expect(run).toMatchObject({ code: 0, stdout: "Forgot API_KEY.\n" });
    expect(await local(root)).toBe("");
    expect(again.stdout).toContain("nothing to forget");
  });

  it("says when nothing uses the variable, or when the environment wins", async () => {
    const root = await project();

    const run = await probe(root, ["var", "API_KEY"], { stdin: SECRET, env: { API_KEY: "x" } });

    expect(run.code).toBe(0);
    expect(run.stderr).toContain("the environment sets API_KEY too, and is read first");
    expect(run.stderr).toContain("no service sends API_KEY yet");
  });

  it.each([
    [["var", "API_KEY"], "", "API_KEY expects a value"],
    [["var", "API_KEY"], "two\nlines", "API_KEY expects a value on one line"],
    [["var", "not-a-name"], "x", "a variable name is made of letters, digits and _"],
    [["var", "--unset"], "", "--unset expects a name"],
  ])("exits 2 on %j", async (args, stdin, message) => {
    const root = await project();

    const run = await probe(root, args, { stdin });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.stderr).not.toContain("two\nlines");
  });

  it("does not touch a local.yml it cannot read", async () => {
    const root = await project();
    await writeFile(join(root, ".probe", "local.yml"), "variables: [unclosed\n");

    const run = await probe(root, ["var", "API_KEY"], { stdin: SECRET });

    expect(run.code).toBe(2);
    expect(run.stderr).toContain(".probe/local.yml is not valid YAML");
    expect(await local(root)).toBe("variables: [unclosed\n");
  });
});
