import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChecks } from "../src/checkers/run";
import { type Config, serviceSchemaV1 } from "../src/config/schema";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const HINT = "start it with: make api";

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(request.url === "/down" ? 500 : 200).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

describe("the hint of a service in the config", () => {
  it("is absent from a service that does not give one", () => {
    expect(serviceSchemaV1.parse({ port: 3000 })).not.toHaveProperty("hint");
  });

  it("is kept as written", () => {
    expect(serviceSchemaV1.parse({ port: 3000, hint: HINT }).hint).toBe(HINT);
  });

  it.each([
    "",
    "   ",
    "two\nlines",
    "a \u001b[31mred\u001b[0m one",
    "tab\there",
    "line\u2028separator",
    3,
  ])("refuses %j", (hint) => {
    expect(serviceSchemaV1.safeParse({ port: 3000, hint }).success).toBe(false);
  });
});

describe("runChecks with a hint", () => {
  const config = (path: string, hint?: string): Config => ({
    schemaVersion: 1,
    services: { api: { host: "127.0.0.1", port, path, ...(hint === undefined ? {} : { hint }) } },
  });
  const run = (path: string, hint?: string, configFile?: string) =>
    runChecks(config(path, hint), [], { timeoutMs: 1_000, configFile });

  it("puts it on a service that is down, in place of the automatic one", async () => {
    const [automatic] = await run("/down");
    const [own] = await run("/down", HINT);

    expect(automatic?.hint).toBeDefined();
    expect(automatic?.hint).not.toBe(HINT);
    expect(own).toMatchObject({ ok: false, hint: HINT });
  });

  it("leaves a service that is up without one", async () => {
    const [result] = await run("/", HINT);

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("hint");
  });

  it("does not rewrite a file name written in it, for another environment", async () => {
    const hint = "see .probe/config.yml";

    const [result] = await run("/down", hint, ".probe/envs/staging.yml");

    expect(result?.hint).toBe(hint);
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

describe("probe add --hint", () => {
  it("writes the hint, shown under the service that is down and in --json", async () => {
    const root = await project();

    expect((await add(root, "api", "/down", "--hint", HINT)).code).toBe(0);
    await add(root, "front", "/", "--hint", "never shown");
    const text = await probe(root, ["check"]);
    const json = await probe(root, ["check", "--json"]);

    expect(await configText(root)).toContain(`hint: "${HINT}"`);
    expect(text.code).toBe(1);
    expect(text.stdout).toMatch(new RegExp(`✗ api.*\\n\\s+${HINT}\\n`));
    expect(text.stdout).not.toContain("never shown");
    const [api, front] = JSON.parse(json.stdout);
    expect(api.hint).toBe(HINT);
    expect(front).not.toHaveProperty("hint");
  });

  it.each(["", "a\nb"])("refuses %j, writing nothing", async (hint) => {
    const root = await project();
    const before = await configText(root);

    const run = await add(root, "api", "/", "--hint", hint);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--hint expects one line of text");
    expect(await configText(root)).toBe(before);
  });

  it("shows the hint of the environment that is checked", async () => {
    const root = await project();
    await mkdir(join(root, ".probe", "envs"));
    await writeFile(
      join(root, ".probe", "envs", "staging.yml"),
      `schemaVersion: 1\nservices:\n  api:\n    host: 127.0.0.1\n    port: ${port}\n    path: /down\n    hint: ask the platform team\n`,
    );

    const run = await probe(root, ["check", "--env", "staging"]);

    expect(run.stdout).toContain("ask the platform team");
  });

  it("names the key in the error of a config with a hint on two lines", async () => {
    const root = await project();
    await writeFile(
      join(root, ".probe", "config.yml"),
      `schemaVersion: 1\nservices:\n  api:\n    port: ${port}\n    hint: "a\\nb"\n`,
    );

    const run = await probe(root, ["check"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("services.api.hint");
    expect(run.stderr).toContain("one line of text");
  });
});
