import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ProbePaths, pathsFor } from "../src/config/discovery";
import { environmentPaths, listEnvironments } from "../src/config/environments";
import { backupPath } from "../src/config/loader";
import { loadVariables, readSkippedServices } from "../src/config/local";
import { tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "s3cr3t-value";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function probe(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", API_KEY: undefined, ...env },
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
  });
}

let server: Server;
let port: number;
let seen: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push(request.url ?? "");
    const refused = request.url === "/prod" && request.headers["x-api-key"] !== SECRET;
    response.writeHead(refused ? 401 : 200).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

beforeEach(() => {
  seen = [];
});

const config = (services: string) => `schemaVersion: 1\nservices:\n${services}`;
const at = (path: string) => `{ host: 127.0.0.1, port: ${port}, path: ${path} }`;

async function project(environments: Record<string, string> = {}): Promise<ProbePaths> {
  const paths = await tempProject(config(`  api: ${at("/local")}\n`));
  await mkdir(join(paths.dir, "envs"));
  for (const [name, yaml] of Object.entries(environments)) {
    await writeFile(join(paths.dir, "envs", name), yaml);
  }
  return paths;
}

const twoEnvironments = () =>
  project({
    "dev.yml": config(`  api: ${at("/dev")}\n  worker: ${at("/dev-worker")}\n`),
    "prod.yml": config(
      `  api:\n    host: 127.0.0.1\n    port: ${port}\n    path: /prod\n    headers:\n      X-Api-Key: \${API_KEY}\n`,
    ),
  });

describe("the environments of a project", () => {
  it("are the yml files of .probe/envs, by name", async () => {
    const paths = await project({
      "prod.yml": "",
      "dev.yml": "",
      "notes.md": "",
      "local.yml": "",
      "bad name.yml": "",
    });

    expect(await listEnvironments(paths)).toEqual(["dev", "prod"]);
  });

  it("are none in a project without .probe/envs", async () => {
    expect(await listEnvironments(await tempProject(config("  {}\n")))).toEqual([]);
  });

  it.each([undefined, "local"])("leave config.yml as the one of %j", async (name) => {
    const paths = await twoEnvironments();

    expect(await environmentPaths(paths, name)).toBe(paths);
  });

  it("read their own file, with the lock and local.yml of the project", async () => {
    const paths = await twoEnvironments();

    expect(await environmentPaths(paths, "prod")).toEqual({
      ...paths,
      config: join(paths.dir, "envs", "prod.yml"),
      environment: "prod",
    });
  });

  it.each(["../config", "envs/prod", "prod.yml", "", ".", "a b"])(
    "refuse %j as a name before any file is looked for",
    async (name) => {
      await expect(environmentPaths(pathsFor("/nowhere"), name)).rejects.toMatchObject({
        code: "USAGE",
      });
    },
  );

  it("name the known ones when asked for another", async () => {
    await expect(environmentPaths(await twoEnvironments(), "staging")).rejects.toMatchObject({
      code: "ENVIRONMENT_UNKNOWN",
      message:
        'no environment "staging" (known: local, dev, prod). Declare it in .probe/envs/staging.yml, written like config.yml.',
    });
  });

  it("keep their backups apart, where .gitignore already covers them", async () => {
    const paths = await environmentPaths(await twoEnvironments(), "prod");

    expect(backupPath(paths, 1)).toBe(join(paths.dir, "env-prod.v1.bak.yml"));
  });

  it("get neither the skips nor the values local.yml keeps for the local one", async () => {
    const local = await twoEnvironments();
    await writeFile(
      local.local,
      `services:\n  api:\n    skip: true\nvariables:\n  API_KEY: ${SECRET}\n`,
    );
    const prod = await environmentPaths(local, "prod");

    expect(await readSkippedServices(prod)).toEqual(new Set());
    expect((await loadVariables(prod, {})).lookup("API_KEY")).toBeUndefined();
    expect((await loadVariables(prod, { API_KEY: "exported" })).lookup("API_KEY")).toBe("exported");
    expect((await loadVariables(local, {})).lookup("API_KEY")).toBe(SECRET);
  });
});

describe("probe check --env", () => {
  it("checks the services of that environment and no other", async () => {
    const { root } = await twoEnvironments();

    const result = await probe(root, ["check", "--env", "dev"]);

    expect(result.code).toBe(0);
    expect(seen.sort()).toEqual(["/dev", "/dev-worker"]);
    expect(result.stdout).toContain("worker");
  });

  it.each([[["check"]], [["check", "--env", "local"]], [["wait"]]])(
    "reaches the local services only with %j",
    async (args) => {
      const { root } = await twoEnvironments();

      expect((await probe(root, args)).code).toBe(0);
      expect(seen).toEqual(["/local"]);
    },
  );

  it("prints the same JSON as before without it, and the same fields with it", async () => {
    const { root } = await twoEnvironments();

    const local = JSON.parse((await probe(root, ["check", "--json"])).stdout);
    const dev = JSON.parse((await probe(root, ["check", "--json", "--env", "dev", "api"])).stdout);

    expect(Object.keys(local[0])).toEqual(["name", "type", "target", "ok", "status", "latencyMs"]);
    expect(Object.keys(dev[0])).toEqual(Object.keys(local[0]));
    expect(dev[0].target).toBe(`http://127.0.0.1:${port}/dev`);
  });

  it("never sends another environment the value local.yml keeps", async () => {
    const paths = await twoEnvironments();
    await writeFile(paths.local, `variables:\n  API_KEY: ${SECRET}\n`);

    const result = await probe(paths.root, ["check", "--env", "prod", "--json"]);

    expect(result.code).toBe(1);
    expect(seen).toEqual([]);
    expect(JSON.parse(result.stdout)[0]).toMatchObject({
      ok: false,
      error: "API_KEY is not set",
      hint: "export API_KEY in the shell that runs probe",
    });
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });

  it("sends the exported value, and shows it nowhere", async () => {
    const { root } = await twoEnvironments();

    const result = await probe(root, ["check", "--env", "prod"], { API_KEY: SECRET });

    expect(result.code).toBe(0);
    expect(seen).toEqual(["/prod"]);
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });

  it("names the file of the environment in a hint", async () => {
    const { root } = await project({
      "dev.yml": config(`  api: { host: 127.0.0.1, port: ${port}, expect: 204 }\n`),
    });

    const result = await probe(root, ["check", "--env", "dev", "--json"]);

    expect(JSON.parse(result.stdout)[0].hint).toBe(
      "the service answers: check `path` and `expect` in .probe/envs/dev.yml",
    );
  });

  it.each([
    ["wrong", "expected 2xx, got 401"],
    ["caf\u00e9\u2603", "API_KEY cannot go in a header"],
  ])("never points at probe var for a value it refuses (%j)", async (value, error) => {
    const { root } = await twoEnvironments();

    const result = await probe(root, ["check", "--env", "prod", "--json"], { API_KEY: value });

    expect(JSON.parse(result.stdout)[0]).toMatchObject({ ok: false, error });
    expect(result.stdout + result.stderr).not.toContain("probe var");
    expect(result.stdout + result.stderr).not.toContain("config.yml");
  });

  it("ignores a skip kept for the local service of the same name", async () => {
    const paths = await twoEnvironments();
    await writeFile(paths.local, "services:\n  api:\n    skip: true\n");

    await probe(paths.root, ["check", "--env", "dev"]);

    expect(seen.sort()).toEqual(["/dev", "/dev-worker"]);
  });

  it.each(["../config", "staging"])("is a usage error with %j, checking nothing", async (name) => {
    const { root } = await twoEnvironments();

    const result = await probe(root, ["check", "--env", name]);

    expect(result.code).toBe(2);
    expect(seen).toEqual([]);
  });

  it("writes nothing in the project", async () => {
    const { root, dir } = await twoEnvironments();
    const before = await readFile(join(dir, "envs", "dev.yml"), "utf8");

    await probe(root, ["check", "--env", "dev"]);

    expect((await readdir(root)).sort()).toEqual([".probe"]);
    expect((await readdir(dir)).sort()).toEqual(["config.yml", "envs"]);
    expect(await readFile(join(dir, "envs", "dev.yml"), "utf8")).toBe(before);
  });
});

describe("a command that works on the local services only", () => {
  it.each([
    [["rm", "api", "--yes", "--env", "prod"]],
    [["rm", "api", "--yes", "--env=prod"]],
    [["add", "other", "-p", "3000", "--env", "prod"]],
    [["var", "API_KEY", "--env", "prod"]],
    [["open", "api", "--env", "prod"]],
    [["sync", "--env", "prod"]],
    [["status", "--env", "prod"]],
    [["migrate", "--env", "prod"]],
    [["--env", "prod"]],
  ])("refuses --env and changes nothing: %j", async (args) => {
    const { root, dir } = await twoEnvironments();
    const before = await readFile(join(dir, "config.yml"), "utf8");

    const result = await probe(root, args);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "--env is read by ls, check, wait, curl only: the other commands work on the local services.",
    );
    expect(await readFile(join(dir, "config.yml"), "utf8")).toBe(before);
    expect((await readdir(root)).sort()).toEqual([".probe"]);
    expect((await readdir(dir)).sort()).toEqual(["config.yml", "envs"]);
  });
});

describe("the other commands with --env", () => {
  it("wait until the services of that environment are up", async () => {
    const { root } = await twoEnvironments();

    expect((await probe(root, ["wait", "--env", "dev", "--timeout", "5"])).code).toBe(0);
    expect(seen.sort()).toEqual(["/dev", "/dev-worker"]);
  });

  it("wait for nothing when a variable is not exported", async () => {
    const paths = await twoEnvironments();
    await writeFile(paths.local, `variables:\n  API_KEY: ${SECRET}\n`);

    const result = await probe(paths.root, ["wait", "--env", "prod", "--timeout", "5"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "api sends API_KEY, which is not set. Export API_KEY in the shell that runs probe.",
    );
    expect(seen).toEqual([]);
  });

  it("list its services", async () => {
    const { root } = await twoEnvironments();

    expect((await probe(root, ["ls", "--env", "dev"])).stdout).toBe(
      `api     http://127.0.0.1:${port}/dev\nworker  http://127.0.0.1:${port}/dev-worker\n`,
    );
  });

  it("say where to write the services of an empty one", async () => {
    const { root } = await project({ "dev.yml": "schemaVersion: 1\nservices: {}\n" });

    expect((await probe(root, ["ls", "--env", "dev"])).stdout).toBe(
      "No services in .probe/envs/dev.yml yet. Write them there, as in .probe/config.yml.\n",
    );
  });

  it("print the curl command of one of its services", async () => {
    const { root } = await twoEnvironments();

    expect((await probe(root, ["curl", "api", "--env", "dev"])).stdout).toBe(
      `curl -i -L --max-time 3 'http://127.0.0.1:${port}/dev'\n`,
    );
  });
});
