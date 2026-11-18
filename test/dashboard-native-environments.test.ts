import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireProbeDir } from "../src/config/discovery";
import { applySelection, parameterChoices } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import { type ActionDeps, serviceActions } from "../src/dashboard/actions";
import { sourceCheck } from "../src/dashboard/native/open";
import { environmentSource } from "../src/dashboard/sources";

describe("the check of an environment", () => {
  let dir: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    if (dir) await rm(dir, { recursive: true, force: true });
    server = undefined;
    dir = undefined;
  });

  const project = async () => {
    const seen: (string | undefined)[] = [];
    server = createServer((request, response) => {
      seen.push(request.headers.authorization);
      response.end("ok");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    dir = await mkdtemp(join(tmpdir(), "probe-grid-"));
    await mkdir(join(dir, ".probe", "envs"), { recursive: true });
    await writeFile(join(dir, ".probe", "config.yml"), "schemaVersion: 1\nservices: {}\n");
    await writeFile(join(dir, ".probe", "local.yml"), "variables:\n  DEV_TOKEN: local-value\n");
    await writeFile(
      join(dir, ".probe", "envs", "dev.yml"),
      `schemaVersion: 1\nservices:\n  api:\n    port: ${port}\n    host: 127.0.0.1\n    headers: { Authorization: 'Bearer \${DEV_TOKEN}' }\n`,
    );
    return { paths: requireProbeDir(dir), seen, port };
  };

  const live = (selection = {}) => ({
    settings: { intervalMs: 60_000, timeoutMs: 3_000 },
    selection,
    skipped: new Set<string>(),
    timeouts: {},
  });

  it("never sends another environment the value local.yml keeps", async () => {
    const { paths, seen } = await project();
    const check = sourceCheck(environmentSource(paths, "dev", {}), live, () => {});

    const results = await check.run(new AbortController().signal);

    expect(results).toMatchObject([{ name: "api", ok: false, error: "DEV_TOKEN is not set" }]);
    expect(seen).toEqual([]);
  });

  it("checks the address of the value chosen among the parameters of its file", async () => {
    const { paths, port } = await project();
    await writeFile(
      join(paths.dir, "envs", "prod.yml"),
      `schemaVersion: 1\nparameters:\n  tenant: { values: [acme, globex], strategy: { kind: path } }\nservices:\n  api: { port: ${port}, host: 127.0.0.1, path: /health }\n`,
    );
    let selection = {};
    const declared: Config[] = [];
    const check = sourceCheck(
      environmentSource(paths, "prod", {}),
      () => live(selection),
      (_env, config) => declared.push(config),
    );
    const signal = new AbortController().signal;

    const first = await check.run(signal);
    selection = { tenant: "globex" };
    const chosen = await check.run(signal);

    expect(parameterChoices(declared[0] as Config)).toEqual({ tenant: ["acme", "globex"] });
    expect(first).toMatchObject([{ target: `http://127.0.0.1:${port}/acme/health` }]);
    expect(chosen).toMatchObject([{ target: `http://127.0.0.1:${port}/globex/health` }]);
  });

  it("sends the exported value and copies its name, not the value", async () => {
    const { paths, seen } = await project();
    const copied: string[] = [];
    const deps: ActionDeps = {
      platform: "linux",
      env: {},
      openUrl: async () => true,
      copyText: async (text) => {
        copied.push(text);
        return true;
      },
      notify: async () => true,
    };
    const declared: Config[] = [];
    const check = sourceCheck(
      environmentSource(paths, "dev", { DEV_TOKEN: "exported-value" }),
      live,
      (_env, config) => declared.push(config),
    );

    const results = await check.run(new AbortController().signal);
    const config = declared[0] as Config;
    const said = await serviceActions(
      (selection) => applySelection(config, selection),
      deps,
    ).onCopy("api", config.services.api?.timeout, {});

    expect(results).toMatchObject([{ name: "api", ok: true }]);
    expect(seen).toEqual(["Bearer exported-value"]);
    expect(copied.join()).toContain("DEV_TOKEN");
    for (const text of [said, copied.join(), JSON.stringify(results)]) {
      expect(text).not.toContain("exported-value");
      expect(text).not.toContain("local-value");
    }
  });
});
