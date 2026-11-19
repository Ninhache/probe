import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { tempDir, tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const NODE = process.execPath;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

// Built by hand: the CI sets PROBE_NO_UPDATE_CHECK, and a test must not depend on what it inherits.
async function probe(cwd: string, ...args: string[]): Promise<Run> {
  const cache = await tempDir();
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: cache,
    XDG_CACHE_HOME: cache,
    PROBE_NO_UPDATE_CHECK: "1",
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, USERPROFILE: cache }
      : {}),
  };
  return new Promise((done) => {
    execFile(NODE, [CLI, ...args], { cwd, env }, (error, stdout, stderr) => {
      const code = (error as { code?: number } | null)?.code;
      done({ code: error ? (typeof code === "number" ? code : 1) : 0, stdout, stderr });
    });
  });
}

const services = async (root: string) =>
  (parse(await readFile(join(root, ".probe", "config.yml"), "utf8")) as { services: object })
    .services as Record<string, Record<string, unknown>>;

const project = async () => (await tempProject("schemaVersion: 1\nservices: {}\n")).root;

describe("probe add with a command", () => {
  it("should write the string form for --command", async () => {
    const root = await project();

    const added = await probe(
      root,
      "add",
      "cache",
      "--command",
      "redis-cli ping",
      "--timeout",
      "5",
    );

    expect(added.code).toBe(0);
    expect(await services(root)).toEqual({
      cache: { type: "command", command: "redis-cli ping", timeout: 5 },
    });
  });

  it("should write the list form for what follows --", async () => {
    const root = await project();

    const added = await probe(
      root,
      "add",
      "db",
      "--tag",
      "infra",
      "--",
      "pg_isready",
      "-q",
      "-h",
      "a b",
    );

    expect(added.code).toBe(0);
    expect(await services(root)).toEqual({
      db: { type: "command", command: ["pg_isready", "-q", "-h", "a b"], tags: ["infra"] },
    });
  });

  it.each([
    ["--port", "3000"],
    ["--url", "http://localhost:3000"],
    ["--method", "POST"],
    ["--expect", "200"],
  ])("should refuse --command with %s", async (flag, value) => {
    const root = await project();

    const added = await probe(root, "add", "x", "--command", "true", flag, value);

    expect(added.code).toBe(2);
    expect(added.stderr).toContain(flag);
    expect(await services(root)).toEqual({});
  });

  it("should refuse an empty command and a command given twice", async () => {
    const root = await project();

    expect((await probe(root, "add", "x", "--command", "")).code).toBe(2);
    expect((await probe(root, "add", "x", "--command", "true", "--", "true")).code).toBe(2);
    expect(await services(root)).toEqual({});
  });

  it("should still ask for a port when no command is given", async () => {
    const root = await project();

    const added = await probe(root, "add", "x");

    expect(added.code).toBe(2);
    expect(added.stderr).toContain("--port");
  });
});

describe("probe check with a command service", () => {
  const config = (up: string, down: string) =>
    [
      "schemaVersion: 1",
      "services:",
      "  up:",
      "    type: command",
      `    command: ${JSON.stringify([NODE, "-e", up])}`,
      "  down:",
      "    type: command",
      `    command: ${JSON.stringify([NODE, "-e", down])}`,
      "  web: { port: 1 }",
      "",
    ].join("\n");

  it("should print exitCode for a command service only, and exit 1 when one is down", async () => {
    const { root } = await tempProject(
      config("process.exit(0)", "console.error('not ready'); process.exit(3)"),
    );

    const checked = await probe(root, "check", "--json");

    expect(checked.code).toBe(1);
    const results = JSON.parse(checked.stdout) as Record<string, unknown>[];
    const byName = Object.fromEntries(results.map((result) => [result.name, result]));
    expect(byName.up).toMatchObject({ type: "command", ok: true, exitCode: 0 });
    expect(byName.down).toMatchObject({ ok: false, exitCode: 3, error: "not ready" });
    expect(byName.web).not.toHaveProperty("exitCode");
  });

  it("should run the command from the project root, wherever probe is started", async () => {
    const script = "process.exit(require('node:fs').existsSync('.probe') ? 0 : 1)";
    const { root } = await tempProject(config(script, script));
    const nested = join(root, "sub");
    await (await import("node:fs/promises")).mkdir(nested);

    const checked = await probe(nested, "check", "up", "--json");

    expect(JSON.parse(checked.stdout)).toMatchObject([{ name: "up", ok: true }]);
  });

  it("should list the command and print it for probe curl", async () => {
    const { root } = await tempProject(
      "schemaVersion: 1\nservices:\n  db:\n    type: command\n    command: [pg_isready, -h, a b]\n",
    );

    const listed = await probe(root, "ls");
    const copied = await probe(root, "curl", "db");

    expect(listed.stdout).toContain('pg_isready -h "a b"');
    expect(copied.stdout.trim()).toBe("pg_isready -h 'a b'");
    expect((await probe(root, "open", "db")).stderr).toContain("no address to open");
  });
});
