import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ProbePaths, pathsFor } from "../src/config/discovery";
import { environmentPaths, listEnvironments } from "../src/config/environments";
import { backupPath } from "../src/config/loader";
import {
  loadVariables,
  readSkippedServices,
  writeServiceSkip,
  writeVariable,
} from "../src/config/local";
import { applySelection } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import { type ActionDeps, serviceActions } from "../src/dashboard/actions";
import { sourceCheck } from "../src/dashboard/native/open";
import { environmentSource } from "../src/dashboard/sources";
import { tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "s3cr3t-value";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function probe(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, input = ""): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", API_KEY: undefined, ...env },
    });
    child.stdin.end(input);
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
      hint: "set it for this machine: probe var API_KEY --env prod (or export it)",
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

  it("never points at probe var for a value the service refuses", async () => {
    const { root } = await twoEnvironments();

    const result = await probe(root, ["check", "--env", "prod", "--json"], { API_KEY: "wrong" });

    expect(JSON.parse(result.stdout)[0]).toMatchObject({ error: "expected 2xx, got 401" });
    expect(result.stdout + result.stderr).not.toContain("probe var");
    expect(result.stdout + result.stderr).not.toContain("config.yml");
  });

  it("points at the value of the environment when it cannot go in a header", async () => {
    const { root } = await twoEnvironments();
    const value = "caf\u00e9\u2603";

    const result = await probe(root, ["check", "--env", "prod", "--json"], { API_KEY: value });

    expect(JSON.parse(result.stdout)[0]).toMatchObject({
      ok: false,
      error: "API_KEY cannot go in a header",
      hint: "a line break or an unusual character in its value: set it again with probe var API_KEY --env prod",
    });
    expect(result.stdout + result.stderr).not.toContain(value);
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
      "--env is read by ls, check, wait, curl, var, doctor only: the other commands work on the local services.",
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

  it("wait for nothing when a variable is not set for them", async () => {
    const paths = await twoEnvironments();
    await writeFile(paths.local, `variables:\n  API_KEY: ${SECRET}\n`);

    const result = await probe(paths.root, ["wait", "--env", "prod", "--timeout", "5"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "api sends API_KEY, which is not set. Set it for this machine: probe var API_KEY --env prod (or export it).",
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

const PROD = (path = "/prod") =>
  config(
    `  api:\n    host: 127.0.0.1\n    port: ${port}\n    path: ${path}\n    headers:\n      X-Api-Key: \${API_KEY}\n`,
  );
const KEPT_FOR_PROD = `envs:\n  prod:\n    variables:\n      API_KEY: ${SECRET}\n`;

const prodAndStaging = () => project({ "prod.yml": PROD(), "staging.yml": PROD() });

describe("what local.yml keeps for an environment", () => {
  it("gives each environment its own value and no other", async () => {
    const local = await prodAndStaging();
    await writeFile(local.local, `variables:\n  API_KEY: local-value\n${KEPT_FOR_PROD}`);
    const prod = await environmentPaths(local, "prod");
    const staging = await environmentPaths(local, "staging");

    expect((await loadVariables(prod, {})).lookup("API_KEY")).toBe(SECRET);
    expect((await loadVariables(staging, {})).lookup("API_KEY")).toBeUndefined();
    expect((await loadVariables(local, {})).lookup("API_KEY")).toBe("local-value");
    expect((await loadVariables(prod, { API_KEY: "exported" })).lookup("API_KEY")).toBe("exported");
  });

  it("writes a value under the environment, in a file nobody else reads", async () => {
    const local = await prodAndStaging();
    await writeFile(local.local, "dashboard:\n  interval: 5\n");
    await chmod(local.local, 0o644);
    const prod = await environmentPaths(local, "prod");

    expect(await writeVariable(prod, "API_KEY", SECRET)).toBe(true);

    expect(await readFile(local.local, "utf8")).toBe(`dashboard:\n  interval: 5\n${KEPT_FOR_PROD}`);
    expect((await stat(local.local)).mode & 0o777).toBe(0o600);
  });

  it("forgets a value and the maps it leaves empty, and nothing else", async () => {
    const local = await prodAndStaging();
    await writeFile(local.local, `variables:\n  API_KEY: local-value\n${KEPT_FOR_PROD}`);
    const prod = await environmentPaths(local, "prod");

    expect(await writeVariable(prod, "API_KEY", undefined)).toBe(true);

    expect(await readFile(local.local, "utf8")).toBe("variables:\n  API_KEY: local-value\n");
  });

  it("skips a service in one environment only", async () => {
    const local = await prodAndStaging();
    const prod = await environmentPaths(local, "prod");
    const staging = await environmentPaths(local, "staging");

    expect(await writeServiceSkip(prod, "api", true)).toBe(true);

    expect(await readFile(local.local, "utf8")).toBe(
      "envs:\n  prod:\n    services:\n      api:\n        skip: true\n",
    );
    expect(await readSkippedServices(prod)).toEqual(new Set(["api"]));
    expect(await readSkippedServices(staging)).toEqual(new Set());
    expect(await readSkippedServices(local)).toEqual(new Set());

    expect(await writeServiceSkip(prod, "api", false)).toBe(true);
    expect(await readFile(local.local, "utf8")).toBe("");
  });

  it.each(["envs: 3\n", "envs:\n  prod: 3\n", "envs:\n  prod:\n    variables: 3\n"])(
    "writes nothing through %j",
    async (text) => {
      const local = await prodAndStaging();
      await writeFile(local.local, text);
      const prod = await environmentPaths(local, "prod");

      expect(await writeVariable(prod, "API_KEY", SECRET)).toBe(false);
      expect(await writeServiceSkip(prod, "api", true)).toBe(text.includes("variables"));
      expect(await readFile(local.local, "utf8")).not.toContain(SECRET);
    },
  );

  it.each(["envs:\n", "envs:\n  prod:\n", "envs:\n  prod:\n    variables:\n", "variables:\n"])(
    "writes through a key left empty: %j",
    async (text) => {
      const local = await prodAndStaging();
      await writeFile(local.local, text);
      const prod = await environmentPaths(local, "prod");

      expect(await writeVariable(prod, "API_KEY", SECRET)).toBe(true);
      expect(await writeVariable(local, "API_KEY", "local-value")).toBe(true);
      expect(await writeServiceSkip(prod, "api", true)).toBe(true);

      expect((await loadVariables(prod, {})).lookup("API_KEY")).toBe(SECRET);
      expect((await loadVariables(local, {})).lookup("API_KEY")).toBe("local-value");
      expect(await readSkippedServices(prod)).toEqual(new Set(["api"]));
    },
  );

  it("says so when local.yml cannot be read", async () => {
    const local = await prodAndStaging();
    await writeFile(local.local, "envs: [\n");

    const variables = await loadVariables(await environmentPaths(local, "prod"), {});

    expect(variables).toMatchObject({ localUnreadable: true, environment: "prod" });
  });

  it("reaches the column of that environment in the dashboard, skips included", async () => {
    const local = await prodAndStaging();
    await writeFile(local.local, KEPT_FOR_PROD);
    const check = (name: string) =>
      sourceCheck(
        environmentSource(local, name, {}),
        () => ({
          settings: { intervalMs: 60_000, timeoutMs: 2000 },
          selection: {},
          skipped: new Set<string>(),
          timeouts: {},
        }),
        () => {},
      ).run(new AbortController().signal);

    expect(await check("prod")).toMatchObject([{ name: "api", ok: true }]);
    expect(await check("staging")).toMatchObject([{ ok: false, error: "API_KEY is not set" }]);
    expect(seen).toEqual(["/prod"]);

    await writeServiceSkip(await environmentPaths(local, "prod"), "api", true);
    expect(await check("prod")).toMatchObject([{ name: "api", skipped: true }]);
    expect(seen).toEqual(["/prod"]);
  });
});

describe("probe var --env", () => {
  it("keeps a value for that environment only, and shows it nowhere", async () => {
    const { root, local } = await prodAndStaging();

    const kept = await probe(root, ["var", "API_KEY", "--env", "prod"], {}, `${SECRET}\n`);

    expect(kept).toMatchObject({
      code: 0,
      stdout: "Kept API_KEY in .probe/local.yml for prod, for this machine only.\n",
    });
    expect(await readFile(local, "utf8")).toBe(KEPT_FOR_PROD);

    const prod = await probe(root, ["check", "--env", "prod", "--json"]);
    const staging = await probe(root, ["check", "--env", "staging", "--json"]);
    const here = await probe(root, ["var"]);

    expect(prod.code).toBe(0);
    expect(seen).toEqual(["/prod"]);
    expect(JSON.parse(staging.stdout)[0]).toMatchObject({
      ok: false,
      error: "API_KEY is not set",
      hint: "set it for this machine: probe var API_KEY --env staging (or export it)",
    });
    expect(here.stdout).toContain("No variable yet.");
    const shown = [kept, prod, staging, here].map((run) => run.stdout + run.stderr).join("");
    expect(shown).not.toContain(SECRET);
  });

  it("lists what is set for that environment", async () => {
    const { root, local } = await prodAndStaging();
    await writeFile(local, KEPT_FOR_PROD);

    expect((await probe(root, ["var", "--env", "prod"])).stdout).toBe(
      "API_KEY  set in .probe/local.yml for prod  (sent by api)\n",
    );
    expect((await probe(root, ["var", "--env", "staging"])).stdout).toBe(
      "API_KEY  not set: probe var API_KEY --env staging  (sent by api)\n",
    );
  });

  it("forgets the value of that environment and leaves the local one", async () => {
    const { root, local } = await prodAndStaging();
    await writeFile(local, `variables:\n  API_KEY: local-value\n${KEPT_FOR_PROD}`);

    const result = await probe(root, ["var", "API_KEY", "--unset", "--env", "prod"]);

    expect(result).toMatchObject({ code: 0, stdout: "Forgot API_KEY for prod.\n" });
    expect(await readFile(local, "utf8")).toBe("variables:\n  API_KEY: local-value\n");
  });

  it("writes at the top with --env local, as without it", async () => {
    const { root, local } = await prodAndStaging();

    await probe(root, ["var", "API_KEY", "--env", "local"], {}, "local-value");

    expect(await readFile(local, "utf8")).toBe("variables:\n  API_KEY: local-value\n");
  });

  it("refuses an environment that is not there, and keeps nothing", async () => {
    const { root, local } = await prodAndStaging();

    const result = await probe(root, ["var", "API_KEY", "--env", "qa"], {}, SECRET);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('no environment "qa"');
    await expect(readFile(local, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves aside a service skipped for that environment", async () => {
    const { root, local } = await prodAndStaging();
    await writeFile(local, "envs:\n  prod:\n    services:\n      api:\n        skip: true\n");

    const result = await probe(root, ["check", "--env", "prod"], { API_KEY: SECRET });
    await probe(root, ["check", "--env", "staging"], { API_KEY: SECRET });

    expect(result.code).toBe(0);
    expect(seen).toEqual(["/prod"]);
  });
});

describe("a value kept for an environment", () => {
  it("is never printed by probe curl", async () => {
    const { root, local } = await prodAndStaging();
    await writeFile(local, KEPT_FOR_PROD);

    const result = await probe(root, ["curl", "api", "--env", "prod"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("$API_KEY");
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });

  it("is never in the command the dashboard copies", async () => {
    const local = await prodAndStaging();
    await writeFile(local.local, KEPT_FOR_PROD);

    let declared: Config | undefined;
    await sourceCheck(
      environmentSource(local, "prod", {}),
      () => ({
        settings: { intervalMs: 60_000, timeoutMs: 2000 },
        selection: {},
        skipped: new Set<string>(),
        timeouts: {},
      }),
      (_env, config) => {
        declared = config;
      },
    ).run(new AbortController().signal);
    const config = declared as Config;
    const deps: ActionDeps = {
      platform: "linux",
      env: {},
      openUrl: async () => true,
      copyText: async () => true,
      notify: async () => true,
    };
    const copied = await serviceActions(
      (selection) => applySelection(config, selection),
      deps,
    ).onCopy("api", undefined, {});

    expect(copied).toContain("$API_KEY");
    expect(copied).not.toContain(SECRET);
  });
});

describe("probe env", () => {
  it("lists the environments and their files", async () => {
    const { root } = await twoEnvironments();

    expect((await probe(root, ["env"])).stdout).toBe(
      "local  .probe/config.yml\ndev    .probe/envs/dev.yml\nprod   .probe/envs/prod.yml\n",
    );
  });

  it("creates one from another, and copies no value", async () => {
    const paths = await project({ "prod.yml": `# production\n${PROD()}` });
    await writeFile(paths.local, KEPT_FOR_PROD);

    const result = await probe(paths.root, ["env", "staging", "--from", "prod"]);

    expect(result).toMatchObject({
      code: 0,
      stdout: [
        "Created .probe/envs/staging.yml from .probe/envs/prod.yml.",
        "Change the addresses there, then: probe check --env staging",
        "It sends API_KEY: probe var API_KEY --env staging (or export it).",
        "",
      ].join("\n"),
    });
    expect(await readFile(join(paths.dir, "envs", "staging.yml"), "utf8")).toBe(
      await readFile(join(paths.dir, "envs", "prod.yml"), "utf8"),
    );
    expect(await readFile(paths.local, "utf8")).toBe(KEPT_FOR_PROD);
    expect(result.stdout + result.stderr).not.toContain(SECRET);
    const staging = await environmentPaths(paths, "staging");
    expect((await loadVariables(staging, {})).lookup("API_KEY")).toBeUndefined();
  });

  it("creates an empty one with --empty, which loads and checks nothing", async () => {
    const paths = await project({ "prod.yml": PROD() });
    await writeFile(paths.local, KEPT_FOR_PROD);

    const result = await probe(paths.root, ["env", "qa", "--empty"]);

    expect(result).toMatchObject({
      code: 0,
      stdout:
        "Created .probe/envs/qa.yml, with no service.\nAdd services there, then: probe check --env qa\n",
    });
    expect(await readFile(join(paths.dir, "envs", "qa.yml"), "utf8")).toBe(
      "schemaVersion: 1\nservices: {}\n",
    );
    expect(await readFile(paths.local, "utf8")).toBe(KEPT_FOR_PROD);
    expect((await probe(paths.root, ["env"])).stdout).toContain(".probe/envs/qa.yml");
    expect((await probe(paths.root, ["ls", "--env", "qa"])).code).toBe(0);
  });

  it("refuses --empty with --from, and without a name, and writes nothing", async () => {
    const paths = await project({ "prod.yml": PROD() });

    const both = await probe(paths.root, ["env", "qa", "--empty", "--from", "prod"]);
    const nameless = await probe(paths.root, ["env", "--empty"]);

    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain("--empty and --from conflict");
    expect(nameless.code).not.toBe(0);
    expect(nameless.stderr).toContain("expect the name to create");
    expect(await listEnvironments(paths)).toEqual(["prod"]);
  });

  it("copies the local services by default, in a project without envs/", async () => {
    const paths = await tempProject(config(`  api: ${at("/local")}\n`));

    const result = await probe(paths.root, ["env", "prod"]);

    expect(result.stdout).toContain("Created .probe/envs/prod.yml from .probe/config.yml.");
    expect(await readFile(join(paths.dir, "envs", "prod.yml"), "utf8")).toBe(
      await readFile(paths.config, "utf8"),
    );
    expect((await probe(paths.root, ["check", "--env", "prod"])).code).toBe(0);
  });

  it.each([
    [["env", "prod"], ".probe/envs/prod.yml is already there"],
    [["env", "local"], "local is .probe/config.yml"],
    [["env", "../x"], "an environment name is made of letters"],
    [["env", "qa", "--from", "nope"], 'no environment "nope"'],
    [["env", "--from", "dev"], "--from and --empty expect the name to create"],
  ])("refuses %j", async (args, message) => {
    const paths = await twoEnvironments();
    const before = await readFile(join(paths.dir, "envs", "prod.yml"), "utf8");

    const result = await probe(paths.root, args);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(await readFile(join(paths.dir, "envs", "prod.yml"), "utf8")).toBe(before);
    expect((await readdir(join(paths.dir, "envs"))).sort()).toEqual(["dev.yml", "prod.yml"]);
  });
});
