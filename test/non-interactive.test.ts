import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inheritedEnv, makeEnv, tempDir } from "./helpers";

// The interactive layer adds to the CLI, it replaces nothing: these tests freeze what scripts,
// CI and the Makefile get, and keep the interactive libraries off that path.

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const FIXTURES = resolve(import.meta.dirname, "fixtures");
const DIST_URL = pathToFileURL(resolve(CLI, "..")).href;
const RECORDER = pathToFileURL(join(FIXTURES, "record-modules.mjs")).href;

const INTERACTIVE_PACKAGES = ["@clack", "@inquirer"];

/**
 * Alert threshold: bytes of JavaScript `probe --version` may load. Counted, not timed, so a loaded
 * machine cannot fail it. About 1.3 MB at 0.23.1 (mostly zod and yaml); the dashboard chunk alone adds about 1 MB.
 */
const STARTUP_BUDGET_BYTES = 2_000_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function node(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      args,
      { cwd, env: { ...inheritedEnv(), PROBE_NO_UPDATE_CHECK: "1", ...makeEnv(true), ...env } },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        done({ code: typeof code === "number" ? code : 1, stdout, stderr });
      },
    );
  });
}

let server: Server;
let port: number;
let closedPort: number;
let version: string;

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

  version = JSON.parse(await readFile(resolve(CLI, "..", "..", "package.json"), "utf8")).version;
});

afterAll(() => server.close());

async function project(): Promise<string> {
  const cwd = await tempDir();
  const setup = [
    ["init"],
    ["add", "api", "-p", String(port), "--host", "127.0.0.1", "--path", "/health"],
    ["add", "db", "-p", String(closedPort), "--host", "127.0.0.1", "--expect", "200,204"],
  ];
  for (const args of setup) expect((await node([CLI, ...args], cwd)).code).toBe(0);
  return cwd;
}

function stable(text: string): string {
  return text
    .replaceAll(`:${port}`, ":UP_PORT")
    .replaceAll(`:${closedPort}`, ":DOWN_PORT")
    .replace(/\d+ms/g, "Nms")
    .replace(/"latencyMs": \d+/g, '"latencyMs": N')
    .replaceAll(version, "VERSION");
}

describe("off a terminal", () => {
  it.each([
    ["check", ["check"]],
    ["check-json", ["check", "--json"]],
    ["ls", ["ls"]],
    ["status", ["status"]],
    ["no-argument", []],
  ])("%s prints what it printed before the interactive layer", async (name, args) => {
    const { code, stdout, stderr } = await node([CLI, ...args], await project());
    const output = `exit code: ${code}\n--- stdout\n${stable(stdout)}--- stderr\n${stable(stderr)}`;

    await expect(output).toMatchFileSnapshot(join(FIXTURES, "non-interactive", `${name}.txt`));
  });

  it.each([
    [["check"]],
    [["check", "--json"]],
    [["ls"]],
    [["status"]],
    [["wait", "--timeout", "1"]],
    [["rm", "api"]],
    [["add"]],
    // Bare `probe` is the dashboard's entry: off a terminal it must stop before the import.
    [[]],
  ])("probe %s loads no interactive library", async (args) => {
    const cwd = await project();
    const modules = join(cwd, "modules.txt");
    await node(["--import", RECORDER, CLI, ...args], cwd, { PROBE_TEST_MODULES_FILE: modules });
    const loaded = (await readFile(modules, "utf8")).split("\n");

    // Proves the recorder sees the dependencies: without it the next assertion proves nothing.
    expect(loaded.some((url) => url.includes("/node_modules/citty/"))).toBe(true);
    const isInteractive = (text: string) =>
      INTERACTIVE_PACKAGES.some((name) => text.includes(`/node_modules/${name}/`));
    expect(loaded.filter(isInteractive)).toEqual([]);

    // The dashboard's libraries are bundled: esbuild leaves their source paths in the chunk.
    const chunks = loaded.filter((url) => url.startsWith(DIST_URL));
    expect(chunks.length).toBeGreaterThan(0);
    for (const url of chunks) {
      expect(isInteractive(await readFile(fileURLToPath(url), "utf8")), url).toBe(false);
    }
  });

  it("starts within the budget", async () => {
    const cwd = await tempDir();
    const modules = join(cwd, "modules.txt");
    await node(["--import", RECORDER, CLI, "--version"], cwd, { PROBE_TEST_MODULES_FILE: modules });
    const files = new Set(
      (await readFile(modules, "utf8")).split("\n").filter((url) => url.startsWith("file:")),
    );
    const sizes = await Promise.all([...files].map(async (url) => (await stat(new URL(url))).size));

    expect(files.has(pathToFileURL(CLI).href)).toBe(true);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(STARTUP_BUDGET_BYTES);
  });
});
