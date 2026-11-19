import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServiceFields } from "../src/commands/service-writes";
import type { ProbePaths } from "../src/config/discovery";
import { reference } from "../src/config/headers";
import { loadConfig } from "../src/config/loader";
import { liveEditing } from "../src/dashboard/editing";
import type { DashboardSettings } from "../src/dashboard/settings";
import { dashboardWrites } from "../src/dashboard/writes";
import { makefilePath, syncMakefile } from "../src/makefile/sync";
import { tempProject } from "./helpers";

const SETTINGS = { intervalMs: 2000, timeoutMs: 3000 } as DashboardSettings;
const SECRET = "s3cr3t-value-for-prod";

const fields = (over: Partial<ServiceFields> = {}): ServiceFields => ({
  host: "example.com",
  port: 8080,
  path: "/health",
  expect: undefined,
  ...over,
});

/** A project with acme in config.yml and acme and globex in envs/prod.yml, and a synced Makefile. */
async function project() {
  const paths = await tempProject(
    ["schemaVersion: 1", "services:", "  acme: { port: 3000 }", ""].join("\n"),
  );
  await mkdir(join(paths.dir, "envs"));
  await writeFile(
    join(paths.dir, "envs", "prod.yml"),
    [
      "schemaVersion: 1",
      "services:",
      "  acme: { url: https://example.com/health }",
      "  globex: { url: https://globex.example.com }",
      "",
    ].join("\n"),
  );
  await writeFile(makefilePath(paths), "dev:\n\techo dev\n");
  await syncMakefile(paths, (await loadConfig(paths)).config);
  return paths;
}

const read = (paths: ProbePaths, ...rest: string[]) => readFile(join(paths.dir, ...rest), "utf8");
const shared = async (paths: ProbePaths) => ({
  config: await read(paths, "config.yml"),
  lock: await read(paths, "lock.yml"),
  makefile: await readFile(makefilePath(paths), "utf8"),
});

describe("writing a service of an environment", () => {
  it("changes envs/prod.yml and leaves config.yml, the Makefile and lock.yml byte-identical", async () => {
    const paths = await project();
    const before = await shared(paths);
    const { writes } = dashboardWrites(paths, SETTINGS);

    for (const write of [
      { kind: "add", name: "initech", fields: fields(), env: "prod" },
      { kind: "edit", name: "acme", fields: fields({ port: 9090 }), env: "prod" },
      { kind: "remove", name: "globex", env: "prod" },
    ] as const) {
      const outcome = await writes.onServiceWrite(write);
      expect(outcome.failure).toBeUndefined();
    }

    const prod = (await loadConfig({ ...paths, config: join(paths.dir, "envs", "prod.yml") }))
      .config;
    expect(Object.keys(prod.services).sort()).toEqual(["acme", "initech"]);
    expect(prod.services.acme?.port).toBe(9090);
    expect(await shared(paths)).toEqual(before);
  });

  it("still syncs the Makefile and the lock for a write to config.yml", async () => {
    const paths = await project();
    const before = await shared(paths);
    const { writes } = dashboardWrites(paths, SETTINGS);

    await writes.onServiceWrite({ kind: "add", name: "initech", fields: fields() });

    const after = await shared(paths);
    expect(after.makefile).toContain("check-initech");
    expect(after.lock).not.toBe(before.lock);
  });

  it("names the environment file when the service is already there or gone", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);

    const again = await writes.onServiceWrite({
      kind: "add",
      name: "acme",
      fields: fields(),
      env: "prod",
    });
    const gone = await writes.onServiceWrite({ kind: "remove", name: "initech", env: "prod" });

    expect(again.failure).toBe("acme is already in .probe/envs/prod.yml");
    expect(gone.failure).toBe("initech is no longer in .probe/envs/prod.yml");
  });

  it("refuses an environment that does not exist, without writing anything", async () => {
    const paths = await project();
    const before = await shared(paths);
    const { writes } = dashboardWrites(paths, SETTINGS);

    const outcome = await writes.onServiceWrite({
      kind: "add",
      name: "initech",
      fields: fields(),
      env: "nowhere",
    });

    expect(outcome.failure).toContain('no environment "nowhere"');
    expect(await shared(paths)).toEqual(before);
  });

  it("keeps a secret typed on prod under envs.prod.variables of local.yml only", async () => {
    const paths = await project();
    const before = await shared(paths);
    const prodBefore = await read(paths, "envs", "prod.yml");
    const { writes } = dashboardWrites(paths, SETTINGS);

    const outcome = await writes.onServiceWrite(
      {
        kind: "add",
        name: "initech",
        fields: fields({ headers: { Authorization: `Bearer ${reference("INITECH_TOKEN")}` } }),
        env: "prod",
      },
      { INITECH_TOKEN: SECRET },
    );

    expect(outcome.failure).toBeUndefined();
    const local = await read(paths, "local.yml");
    expect(local).toMatch(/envs:\s+prod:\s+variables:\s+INITECH_TOKEN: /);
    expect(local.indexOf(SECRET)).toBeGreaterThan(local.indexOf("prod:"));
    expect(local.match(/variables:/g)).toHaveLength(1);
    const prod = await read(paths, "envs", "prod.yml");
    expect(prod).not.toContain(SECRET);
    expect(prod).toContain(reference("INITECH_TOKEN"));
    expect(prod).not.toContain("variables:");
    const after = await shared(paths);
    expect(JSON.stringify(after)).not.toContain(SECRET);
    expect(after).toEqual(before);
    expect(prod).not.toBe(prodBefore);
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it("reads the variables of the environment only, never those of another", async () => {
    const paths = await project();
    await writeFile(
      paths.local,
      [
        "variables:",
        "  LOCAL_ONLY: top-level",
        "envs:",
        "  prod:",
        "    variables:",
        "      PROD_ONLY: prod-value",
        "  staging:",
        "    variables:",
        "      STAGING_ONLY: staging-value",
        "",
      ].join("\n"),
    );
    const { writes } = dashboardWrites(paths, SETTINGS);
    const names = ["LOCAL_ONLY", "PROD_ONLY", "STAGING_ONLY"];

    expect(await writes.variableSources(names, "prod")).toEqual({ PROD_ONLY: "local" });
    expect(await writes.variableSources(names)).toEqual({ LOCAL_ONLY: "local" });
  });

  it("undoes and redoes a write to an environment file, and never records local.yml", async () => {
    const paths = await project();
    const original = await read(paths, "envs", "prod.yml");
    const before = await shared(paths);
    const { writes } = dashboardWrites(paths, SETTINGS);
    await writes.onServiceWrite(
      {
        kind: "add",
        name: "initech",
        fields: fields({ headers: { "X-Key": reference("INITECH_KEY") } }),
        env: "prod",
      },
      { INITECH_KEY: SECRET },
    );
    const written = await read(paths, "envs", "prod.yml");
    const local = await read(paths, "local.yml");

    const undone = await writes.onUndo();
    expect(undone.undone).toBe("Undone: add initech");
    expect(await read(paths, "envs", "prod.yml")).toBe(original);
    expect(await read(paths, "local.yml")).toBe(local);

    const redone = await writes.onRedo();
    expect(redone.undone).toBe("Redone: add initech");
    expect(await read(paths, "envs", "prod.yml")).toBe(written);
    expect(await shared(paths)).toEqual(before);
  });

  it("refuses an undo when the environment file was edited since, naming it", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);
    await writes.onServiceWrite({ kind: "add", name: "initech", fields: fields(), env: "prod" });
    await writeFile(join(paths.dir, "envs", "prod.yml"), "schemaVersion: 1\nservices: {}\n");

    const outcome = await writes.onUndo();

    expect(outcome.failure).toBe(".probe/envs/prod.yml changed since: nothing undone");
  });

  it("scopes the editing of an environment to its own config", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);
    const editing = liveEditing((await loadConfig(paths)).config, writes);
    expect(editing.environment?.("prod")).toBeUndefined();
    const prod = (
      await loadConfig({
        ...paths,
        config: join(paths.dir, "envs", "prod.yml"),
        environment: "prod",
      })
    ).config;
    editing.observe?.("prod", prod);

    const scoped = editing.environment?.("prod");
    expect(Object.keys(scoped?.config().services ?? {})).toEqual(["acme", "globex"]);
    expect(Object.keys(editing.config().services)).toEqual(["acme"]);
    const outcome = await scoped?.writeService?.({
      kind: "remove",
      name: "globex",
    });

    expect(outcome?.saved).toBe(true);
    expect(Object.keys(scoped?.config().services ?? {})).toEqual(["acme"]);
    expect(Object.keys(editing.config().services)).toEqual(["acme"]);
  });

  it("points to probe var --env, not the detail panel, for a variable prod does not have", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);
    const editing = liveEditing((await loadConfig(paths)).config, writes);
    const prod = (
      await loadConfig({
        ...paths,
        config: join(paths.dir, "envs", "prod.yml"),
        environment: "prod",
      })
    ).config;
    editing.observe?.("prod", prod);

    const outcome = await editing.environment?.("prod")?.writeService?.({
      kind: "add",
      name: "initech",
      fields: fields({ headers: { "X-Key": reference("INITECH_KEY") } }),
    });

    expect(outcome?.warning).toBe(
      "INITECH_KEY not set for prod: probe var INITECH_KEY --env prod (or export it)",
    );
  });
});
