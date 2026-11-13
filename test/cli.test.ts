import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const ANSI = "\u001b[";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function exec(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Run> {
  return new Promise((done) => {
    execFile(
      file,
      args,
      { cwd, env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", ...env } },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        done({ code: typeof code === "number" ? code : 1, stdout, stderr });
      },
    );
  });
}

const probe = (cwd: string, ...args: string[]) => exec(process.execPath, [CLI, ...args], cwd);

let server: Server;
let port: number;
let closedPort: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(request.url === "/health" ? 200 : 404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;

  const closed = createServer();
  await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
  closedPort = (closed.address() as AddressInfo).port;
  await new Promise((done) => closed.close(done));
});

afterAll(() => server.close());

async function project(): Promise<string> {
  const root = await tempDir();
  expect((await probe(root, "init")).code).toBe(0);
  return root;
}

const addApi = (root: string) =>
  probe(root, "add", "api", "-p", String(port), "--host", "127.0.0.1", "--path", "/health");
const addDown = (root: string) =>
  probe(root, "add", "down", "-p", String(closedPort), "--host", "127.0.0.1");

describe("probe init", () => {
  it("creates the config, the lock, the Makefile and the .gitignore entries", async () => {
    const root = await project();

    expect(await readFile(join(root, ".probe", "config.yml"), "utf8")).toContain(
      "schemaVersion: 1\nservices: {}\n",
    );
    expect(await readFile(join(root, ".probe", "lock.yml"), "utf8")).toMatch(
      /cliVersion: \d+\.\d+\.\d+\nmakefile:\n {2}hash: [0-9a-f]{64}\n/,
    );
    expect(await readFile(join(root, "Makefile"), "utf8")).toContain("# >>> probe");
    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      ".probe/local.yml\n.probe/*.bak.yml\n",
    );
  });

  it("appends to an existing .gitignore without duplicating", async () => {
    const root = await tempDir();
    await writeFile(join(root, ".gitignore"), "node_modules\n.probe/local.yml");

    await probe(root, "init");

    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
      "node_modules\n.probe/local.yml\n.probe/*.bak.yml\n",
    );
  });

  it("refuses to run twice", async () => {
    const root = await project();
    const again = await probe(root, "init");

    expect(again.code).toBe(2);
    expect(again.stderr).toContain("probe: .probe/ already exists here.");
  });
});

describe("probe add / rm / ls", () => {
  it("adds a service to the config and to the Makefile", async () => {
    const root = await project();

    expect((await addApi(root)).code).toBe(0);

    expect(await readFile(join(root, ".probe", "config.yml"), "utf8")).toContain(
      `services:\n  api: { port: ${port}, host: 127.0.0.1, path: /health }\n`,
    );
    expect(await readFile(join(root, "Makefile"), "utf8")).toContain("check-api:");
    expect((await probe(root, "ls")).stdout).toBe(`api  http://127.0.0.1:${port}/health\n`);
  });

  it("stores --expect as a number or a list", async () => {
    const root = await project();
    await probe(root, "add", "one", "-p", "3000", "--expect", "204");
    await probe(root, "add", "many", "--port", "3001", "--expect", "200,204");

    const config = await readFile(join(root, ".probe", "config.yml"), "utf8");
    expect(config).toContain("one: { port: 3000, expect: 204 }");
    expect(config).toContain("many: { port: 3001, expect: [ 200, 204 ] }");
  });

  it("rejects a duplicate, a bad port and a bad name with exit code 2", async () => {
    const root = await project();
    await addApi(root);

    expect(await addApi(root)).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("already exists"),
    });
    expect((await probe(root, "add", "x", "-p", "abc")).stderr).toContain(
      "--port expects a number",
    );
    expect((await probe(root, "add", "x", "-p", "70000")).code).toBe(2);
    expect((await probe(root, "add", "bad name", "-p", "3000")).code).toBe(2);
    expect((await probe(root, "add", "x")).code).toBe(2);
  });

  it("handles names that exist on Object.prototype", async () => {
    const root = await project();

    expect((await probe(root, "rm", "constructor")).code).toBe(2);
    expect((await probe(root, "add", "constructor", "-p", "3000")).code).toBe(0);
    expect((await probe(root, "add", "toString", "-p", "3001")).code).toBe(0);
    expect((await probe(root, "rm", "constructor")).code).toBe(0);

    const config = await readFile(join(root, ".probe", "config.yml"), "utf8");
    expect(config).not.toContain("constructor");
    expect(config).toContain("toString: { port: 3001 }");
  });

  it("exits 2 without a stack trace on a file system error", async () => {
    const root = await project();
    await chmod(join(root, "Makefile"), 0o444);

    const result = await probe(root, "add", "api", "-p", "3000");

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^probe: .*EACCES/);
    expect(result.stderr).not.toContain("    at ");
  });

  it("removes a service from the config and from the Makefile", async () => {
    const root = await project();
    await addApi(root);

    expect((await probe(root, "rm", "api")).code).toBe(0);

    expect(await readFile(join(root, "Makefile"), "utf8")).not.toContain("check-api");
    expect((await probe(root, "ls")).stdout).toContain("No services yet");
    expect((await probe(root, "rm", "api")).code).toBe(2);
  });
});

describe("probe check", () => {
  it("exits 0 and prints a tick when the service is up", async () => {
    const root = await project();
    await addApi(root);

    const result = await probe(root, "check");

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^✓ api {2}http:\/\/127\.0\.0\.1:\d+\/health {2}200 {2}\d+ms\n$/);
  });

  it("exits 1 when a service is down", async () => {
    const root = await project();
    await addApi(root);
    await addDown(root);

    const result = await probe(root, "check");

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("✓ api");
    expect(result.stdout).toMatch(/✗ down .*connection refused/);
  });

  it("checks only the named services", async () => {
    const root = await project();
    await addApi(root);
    await addDown(root);

    expect(await probe(root, "check", "api")).toMatchObject({ code: 0 });
    expect((await probe(root, "check", "down")).code).toBe(1);
    expect(await probe(root, "check", "nope")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("unknown service: nope"),
    });
  });

  it("prints JSON only with --json", async () => {
    const root = await project();
    await addApi(root);
    await addDown(root);

    const result = await probe(root, "check", "--json");

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject([
      { name: "api", type: "http", ok: true, status: 200 },
      { name: "down", ok: false, error: "connection refused" },
    ]);
  });

  it("never colors output when stdout is not a TTY", async () => {
    const root = await project();
    await addApi(root);

    expect((await probe(root, "check")).stdout).not.toContain(ANSI);
  });

  it("rejects a bad --timeout", async () => {
    const root = await project();
    expect((await probe(root, "check", "--timeout", "0")).code).toBe(2);
    expect((await probe(root, "check", "--timeout", "3000000")).code).toBe(2);
  });

  it("accepts a fractional --timeout", async () => {
    const root = await project();
    await addApi(root);
    expect((await probe(root, "check", "--timeout", "0.1234")).code).toBe(0);
  });

  it("works from a sub-directory", async () => {
    const root = await project();
    await addApi(root);
    const nested = join(root, "src", "deep");
    await mkdir(nested, { recursive: true });

    expect((await probe(nested, "check")).code).toBe(0);
  });

  it("explains what to do outside a probe project", async () => {
    const result = await probe(await tempDir(), "check");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Run `probe init`");
  });
});

describe("probe wait", () => {
  it("exits 0 as soon as a service that starts late is up", async () => {
    const root = await project();
    const late = createServer((_request, response) => response.writeHead(200).end());
    await probe(root, "add", "late", "-p", String(closedPort), "--host", "127.0.0.1");
    const starting = setTimeout(() => late.listen(closedPort, "127.0.0.1"), 500);

    try {
      const result = await probe(root, "wait", "--timeout", "15", "--interval", "0.2");

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/^✓ late .* 200 {2}\d+ms\n$/);
      expect(result.stderr).toMatch(/^waiting for late\nlate up after \d+\.\ds\n$/);
    } finally {
      clearTimeout(starting);
      await new Promise((done) => late.close(done));
    }
  });

  it("exits 1 after the total timeout and names the services still down", async () => {
    const root = await project();
    await addApi(root);
    await addDown(root);

    const result = await probe(root, "wait", "--timeout", "1", "--interval", "0.2");

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/✗ down .*connection refused/);
    expect(result.stderr).toContain("probe: still down after 1s: down");
  });

  it("chains in a shell script and keeps stdout for the report", async () => {
    const root = await project();
    await addApi(root);
    const node = JSON.stringify(process.execPath);

    const up = await exec("sh", ["-c", `${node} "${CLI}" wait && echo chained`], root);
    await addDown(root);
    const down = await exec(
      "sh",
      ["-c", `${node} "${CLI}" wait --timeout 0.5 && echo chained`],
      root,
    );

    expect(up.stdout).toMatch(/^✓ api .*\nchained\n$/);
    expect(up.stderr).toBe("");
    expect(down.stdout).not.toContain("chained");
  });

  it("prints only the final JSON on stdout with --json", async () => {
    const root = await project();
    await addApi(root);

    const result = await probe(root, "wait", "--json");

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject([{ name: "api", ok: true, status: 200 }]);
  });

  it("exits 2 at once on an unknown service or a bad option", async () => {
    const root = await project();
    await addApi(root);

    expect(await probe(root, "wait", "nope")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("unknown service: nope"),
    });
    expect((await probe(root, "wait", "--timeout", "0")).code).toBe(2);
    expect((await probe(root, "wait", "--interval", "abc")).code).toBe(2);
    expect((await probe(root, "wait", "--max-interval", "-1")).code).toBe(2);
  });

  it("does not wait when no service is declared", async () => {
    const result = await probe(await project(), "wait");

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("No services yet");
  });
});

describe("probe status / sync", () => {
  it("reports a clean project", async () => {
    const root = await project();
    const { stdout, code } = await probe(root, "status");

    expect(code).toBe(0);
    expect(stdout).toContain("migration  none pending");
    expect(stdout).toContain("makefile   in sync");
    expect(stdout).toContain("update     check disabled");
  });

  it("detects a hand-edited block, and sync restores it without touching other targets", async () => {
    const root = await project();
    await addApi(root);
    const makefile = join(root, "Makefile");
    const generated = await readFile(makefile, "utf8");
    const mine = "\nmine: ## My own target\n\t@echo mine\n";
    await writeFile(makefile, generated.replace("@$(PROBE) check api", "@echo hacked") + mine);

    expect((await probe(root, "status")).stdout).toContain("block edited by hand");

    expect((await probe(root, "sync")).stdout).toContain("Updated the probe block");
    expect(await readFile(makefile, "utf8")).toBe(generated + mine);
    expect((await probe(root, "status")).stdout).toContain("makefile   in sync");
    expect((await probe(root, "sync")).stdout).toContain("already in sync");
  });

  it("keeps a hand-edited block when a service is added or removed", async () => {
    const root = await project();
    await addApi(root);
    const makefile = join(root, "Makefile");
    const edited = (await readFile(makefile, "utf8")).replace("@$(PROBE) check api", "@echo mine");
    await writeFile(makefile, edited);

    const added = await addDown(root);

    expect(added).toMatchObject({ code: 0, stderr: expect.stringContaining("edited by hand") });
    expect(await readFile(makefile, "utf8")).toBe(edited);
    expect((await probe(root, "ls")).stdout).toContain("down");

    expect((await probe(root, "rm", "down")).stderr).toContain("probe sync");
    expect(await readFile(makefile, "utf8")).toBe(edited);

    await probe(root, "sync");
    expect(await readFile(makefile, "utf8")).toContain("@$(PROBE) check api");
  });

  it("reports a config edited by hand as out of date", async () => {
    const root = await project();
    const config = join(root, ".probe", "config.yml");
    await writeFile(config, "schemaVersion: 1\nservices:\n  web: { port: 8080 }\n");

    expect((await probe(root, "status")).stdout).toContain("out of date");
  });
});

describe("probe migrate", () => {
  it("has nothing to do on a current config", async () => {
    const root = await project();
    expect((await probe(root, "migrate")).stdout).toContain("already at schema v1");
  });

  it("refuses a config written by a newer probe", async () => {
    const root = await project();
    await writeFile(join(root, ".probe", "config.yml"), "schemaVersion: 2\nservices: {}\n");

    for (const command of ["check", "ls", "status", "migrate", "sync"]) {
      const result = await probe(root, command);
      expect(result.code, command).toBe(2);
      expect(result.stderr, command).toContain("upgrade probe");
    }
  });
});

describe("probe (top level)", () => {
  it("prints the version", async () => {
    const result = await probe(await tempDir(), "--version");
    const { version } = JSON.parse(
      await readFile(resolve(CLI, "..", "..", "package.json"), "utf8"),
    );

    expect(result).toMatchObject({ code: 0, stdout: `${version}\n` });
  });

  it("exits 2 on an unknown command", async () => {
    expect((await probe(await tempDir(), "nope")).code).toBe(2);
  });
});

describe("generated Makefile with real make", () => {
  const make = (root: string, target: string) =>
    exec("make", [target, `PROBE=${process.execPath} ${CLI}`], root);

  it("make help lists probe targets and hand-written ones", async () => {
    const root = await project();
    await addApi(root);
    const makefile = join(root, "Makefile");
    await writeFile(
      makefile,
      `${await readFile(makefile, "utf8")}\nmine: ## My own target\n\t@echo mine\n`,
    );

    const { stdout, code } = await make(root, "help");

    expect(code).toBe(0);
    expect(stdout).toMatch(/^ {2}help +List available targets$/m);
    expect(stdout).toMatch(/^ {2}check +Check that every service responds$/m);
    expect(stdout).toMatch(/^ {2}check-api +Check api$/m);
    expect(stdout).toMatch(/^ {2}mine +My own target$/m);
  });

  it("make check and make check-<name> follow the services' state", async () => {
    const root = await project();
    await addApi(root);

    expect(await make(root, "check")).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("✓ api"),
    });
    expect((await make(root, "check-api")).code).toBe(0);

    await addDown(root);
    expect((await make(root, "check")).code).not.toBe(0);
    expect((await make(root, "check-down")).stdout).toContain("✗ down");
  });
});
