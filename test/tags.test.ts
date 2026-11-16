import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selectServices } from "../src/checkers/select";
import { tagsFrom } from "../src/commands/shared";
import { loadConfig } from "../src/config/loader";
import { type Config, serviceSchemaV1 } from "../src/config/schema";
import { tempDir, tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

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

describe("the tags of a service in the config", () => {
  it("are absent from a service that gives none", () => {
    expect(serviceSchemaV1.parse({ port: 3000 })).not.toHaveProperty("tags");
  });

  it("are kept as written", () => {
    expect(serviceSchemaV1.parse({ port: 3000, tags: ["back", "infra_2"] }).tags).toEqual([
      "back",
      "infra_2",
    ]);
  });

  it.each(["back", ["with space"], ["a,b"], [""], ["-dash"], [3], { back: true }])(
    "refuse %j",
    (tags) => {
      expect(serviceSchemaV1.safeParse({ port: 3000, tags }).success).toBe(false);
    },
  );

  it("load from a config file", async () => {
    const paths = await tempProject(
      "schemaVersion: 1\nservices:\n  api: { port: 3000, tags: [back] }\n",
    );

    expect((await loadConfig(paths)).config.services.api?.tags).toEqual(["back"]);
  });
});

describe("selectServices", () => {
  const service = (tags?: string[]) => ({ host: "localhost", port: 1, path: "/", tags });
  const config: Config = {
    schemaVersion: 1,
    services: {
      api: service(["back"]),
      db: service(["back", "infra"]),
      cache: service(["infra"]),
      front: service(),
    },
  };
  const names = (picked: string[], tags: string[], skipped: string[] = []) =>
    selectServices(config, picked, tags, new Set(skipped)).map(({ name, skipped: skip }) =>
      skip ? `${name} (skipped)` : name,
    );

  it("takes every service when nothing is asked", () => {
    expect(names([], [])).toEqual(["api", "db", "cache", "front"]);
  });

  it("takes the services of a tag, in the order of the config", () => {
    expect(names([], ["infra"])).toEqual(["db", "cache"]);
  });

  it("takes the services of any of several tags, once each", () => {
    expect(names([], ["infra", "back"])).toEqual(["api", "db", "cache"]);
  });

  it("adds the services of a tag to those named", () => {
    expect(names(["front", "db"], ["back"])).toEqual(["front", "db", "api"]);
  });

  it("leaves a skipped service of a tag skipped", () => {
    expect(names([], ["back"], ["db"])).toEqual(["api", "db (skipped)"]);
  });

  it("checks a skipped service that is named, even when a tag selects it too", () => {
    expect(names(["db"], ["back"], ["db", "api"])).toEqual(["db", "api (skipped)"]);
  });

  it("refuses a tag that no service carries, naming those that exist", () => {
    expect(() => names([], ["bak", "infra"])).toThrow("unknown tag: bak. Known: back, infra.");
  });

  it("refuses a service name given as a tag", () => {
    expect(() => names([], ["api"])).toThrow(/unknown tag: api/);
  });
});

describe("tagsFrom", () => {
  it.each([
    [["--tag", "back"], ["back"]],
    [["--tag=back,infra"], ["back", "infra"]],
    [
      ["api", "--tag", "back", "--json", "--tag", "infra"],
      ["back", "infra"],
    ],
    [
      ["--tag", "back, infra", "--tag", "back"],
      ["back", "infra"],
    ],
    [["api"], []],
    [["--", "--tag", "back"], []],
  ])("reads %j", (rawArgs, tags) => {
    expect(tagsFrom(rawArgs)).toEqual(tags);
  });

  it.each([
    [["--tag"]],
    [["--tag", ""]],
    [["--tag", "back,"]],
    [["--tag", "--json"]],
    [["--tag=a b"]],
  ])("refuses %j", (rawArgs) => {
    expect(() => tagsFrom(rawArgs)).toThrow(/--tag expects tags made of/);
  });
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

const configText = (root: string) => readFile(join(root, ".probe", "config.yml"), "utf8");
const add = (root: string, name: string, path: string, ...more: string[]) =>
  probe(root, ["add", name, "-p", String(port), "--host", "127.0.0.1", "--path", path, ...more]);

async function project(): Promise<string> {
  const root = await tempDir();
  await probe(root, ["init"]);
  await add(root, "api", "/", "--tag", "back");
  await add(root, "db", "/down", "--tag", "back,infra");
  await add(root, "front", "/down");
  return root;
}

const checked = async (root: string, ...args: string[]) => {
  const run = await probe(root, [...args, "--json"]);
  const results = JSON.parse(run.stdout) as { name: string }[];
  return { code: run.code, names: results.map(({ name }) => name), results };
};

describe("probe add --tag", () => {
  it("writes the tags, listed by probe ls", async () => {
    const root = await project();

    const listed = await probe(root, ["ls"]);

    expect(await configText(root)).toContain("path: /down, tags: [ back, infra ] }");
    expect(listed.stdout).toMatch(/^db .*tags back, infra$/m);
    expect(listed.stdout).not.toMatch(/^front .*tags/m);
  });

  it("refuses a tag that is not a name, writing nothing", async () => {
    const root = await project();
    const before = await configText(root);

    const run = await add(root, "cache", "/", "--tag", "a b");

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--tag expects tags made of letters, digits, _ and -");
    expect(await configText(root)).toBe(before);
  });
});

describe("probe check --tag", () => {
  it("checks only the services of the tag", async () => {
    const root = await project();

    expect(await checked(root, "check", "--tag", "back")).toMatchObject({
      code: 1,
      names: ["api", "db"],
    });
    expect(await checked(root, "check", "--tag=back", "--tag", "infra")).toMatchObject({
      names: ["api", "db"],
    });
    expect((await checked(root, "check")).names).toEqual(["api", "db", "front"]);
  });

  it("adds the services of the tag to those named", async () => {
    const root = await project();

    expect((await checked(root, "check", "front", "--tag", "infra")).names).toEqual([
      "front",
      "db",
    ]);
  });

  it("refuses a tag that no service carries, with code 2 and the known ones", async () => {
    const root = await project();

    const run = await probe(root, ["check", "--tag", "bak"]);

    expect(run.code).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("unknown tag: bak. Known: back, infra.");
  });

  it("refuses --tag left without a value", async () => {
    const root = await project();

    const run = await probe(root, ["check", "--tag"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--tag expects tags made of");
  });

  it("leaves a service skipped on this machine skipped", async () => {
    const root = await project();
    await writeFile(join(root, ".probe", "local.yml"), "services:\n  db:\n    skip: true\n");

    const all = await checked(root, "check", "--tag", "back");
    const text = await probe(root, ["check", "--tag", "infra"]);
    const named = await checked(root, "check", "db", "--tag", "back");

    expect(all.code).toBe(0);
    expect(all.results).toMatchObject([
      { name: "api", ok: true },
      { name: "db", skipped: true },
    ]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^- db .*skipped$/m);
    expect(named.code).toBe(1);
    expect(named.results).toMatchObject([{ name: "db", ok: false }, { name: "api" }]);
  });

  it("keeps tags out of --json", async () => {
    const root = await project();

    expect((await checked(root, "check", "--tag", "back")).results[0]).not.toHaveProperty("tags");
  });
});

describe("--tag on the other commands", () => {
  it("makes probe wait wait for the services of the tag only", async () => {
    const root = await project();

    const run = await checked(root, "wait", "--tag", "back", "--timeout", "0.3");
    const up = await probe(root, ["wait", "api", "--timeout", "2"]);

    expect(run).toMatchObject({ code: 1, names: ["api", "db"] });
    expect(up.code).toBe(0);
  });

  it("makes probe doctor diagnose the services of the tag only", async () => {
    const root = await project();

    const run = await probe(root, ["doctor", "--tag", "back", "--json"]);

    const { services } = JSON.parse(run.stdout) as { services: { name: string }[] };
    expect(services.map(({ name }) => name)).toEqual(["api", "db"]);
  });

  it("refuses an unknown tag on probe wait at once", async () => {
    const root = await project();

    const run = await probe(root, ["wait", "--tag", "bak", "--timeout", "5"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("unknown tag: bak");
  });
});

it("leaves the Makefile block in sync when tags are added by hand", async () => {
  const root = await project();
  await probe(root, ["sync"]);
  const config = join(root, ".probe", "config.yml");
  await writeFile(
    config,
    (await readFile(config, "utf8")).replace("path: /down }", "path: /down, tags: [web] }"),
  );

  const status = await probe(root, ["status"]);

  expect((await probe(root, ["ls"])).stdout).toMatch(/^front .*tags web$/m);
  expect(status.stdout).not.toMatch(/outdated|modified/);
});
