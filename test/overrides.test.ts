import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader";
import { readServiceOverrides } from "../src/config/local";
import { overriddenKeys, type ServiceOverrides, withOverrides } from "../src/config/overrides";
import { applySelection } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import { tempProject } from "./helpers";

const PARAMETERS = "parameters:\n  env: { values: [dev], strategy: { kind: url } }\n";

async function configOf(services: string): Promise<Config> {
  const paths = await tempProject(`schemaVersion: 1\n${PARAMETERS}services:\n${services}`);
  return (await loadConfig(paths)).config;
}

const local = (services: ServiceOverrides["services"]): ServiceOverrides => ({
  at: "services",
  services,
});

describe("withOverrides", () => {
  it("leaves the config as it is when local.yml gives nothing", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(withOverrides(config, local({}))).toBe(config);
  });

  it("replaces the value of config.yml with the one of local.yml", async () => {
    const config = await configOf("  api: { port: 3000, timeout: 2 }\n");

    const reached = withOverrides(config, local({ api: { port: 4000, timeout: 5 } }));

    expect(reached.services.api).toMatchObject({ host: "localhost", port: 4000, timeout: 5 });
    expect(config.services.api).toMatchObject({ port: 3000, timeout: 2 });
  });

  it("keeps the scheme of a url when local.yml changes its host, port or path", async () => {
    const config = await configOf("  api: { url: 'https://api.example.com/health?full=1' }\n");

    const reached = withOverrides(
      config,
      local({ api: { host: "localhost", port: 8443, path: "/ready" } }),
    );

    expect(reached.services.api).toMatchObject({
      url: "https://localhost:8443/ready",
      host: "localhost",
      port: 8443,
      path: "/ready",
    });
  });

  it("replaces host, port and path with a url of local.yml", async () => {
    const config = await configOf("  api: { port: 3000, path: /health }\n");

    const reached = withOverrides(config, local({ api: { url: "http://acme.test:8080/up" } }));

    expect(reached.services.api).toMatchObject({
      url: "http://acme.test:8080/up",
      host: "acme.test",
      port: 8080,
      path: "/up",
    });
  });

  it("keeps the host and path taken from urls when local.yml gives a port", async () => {
    const config = await configOf("  web: { urls: { dev: 'http://app.example.com/home' } }\n");

    const reached = withOverrides(config, local({ web: { port: 5173 } }));

    expect(reached.services.web).toMatchObject({
      host: "app.example.com",
      port: 5173,
      path: "/home",
    });
  });

  it("gives a database its local user and database", async () => {
    const config = await configOf(
      "  db: { type: postgres, port: 5432, user: app, database: app }\n",
    );

    const reached = withOverrides(config, local({ db: { user: "me", database: "scratch" } }));

    expect(reached.services.db).toMatchObject({
      type: "postgres",
      user: "me",
      database: "scratch",
    });
  });

  it("gives a command its local words", async () => {
    const config = await configOf("  worker: { type: command, command: 'true' }\n");

    const reached = withOverrides(config, local({ worker: { command: ["node", "-v"] } }));

    expect(reached.services.worker?.command).toEqual(["node", "-v"]);
  });

  it("is applied before the selection of a parameter", async () => {
    const config = await configOf("  api: { port: 3000, path: /health }\n");

    const reached = applySelection(withOverrides(config, local({ api: { port: 4000 } })), {});

    expect(reached.services.api?.port).toBe(4000);
  });

  it("changes nothing but the keys local.yml sets", async () => {
    const config = await configOf(
      [
        "  api: { url: 'https://api.example.com/health' }",
        "  web: { urls: { dev: 'http://app.example.com/' } }",
        "  db: { type: redis, port: 6379, database: 2 }",
        "",
      ].join("\n"),
    );

    for (const name of ["api", "web", "db"]) {
      const reached = withOverrides(config, local({ [name]: { timeout: 3 } }));
      expect(reached.services[name]).toEqual({ ...config.services[name], timeout: 3 });
    }
  });

  it("refuses a key local.yml cannot set, and names it", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(() => withOverrides(config, local({ api: { expect: 204 } as never }))).toThrow(
      "services.api.expect cannot be set there: local.yml sets only url, host, port, path, timeout, command, user, database",
    );
  });

  it("refuses a key the type of the service does not read", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(() => withOverrides(config, local({ api: { user: "me" } }))).toThrow(
      /services\.api\.user: needs `type: postgres`/,
    );
  });

  it("refuses a service config.yml does not have", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(() => withOverrides(config, local({ apy: { port: 4000 } }))).toThrow(
      "services.apy overrides a service the config does not have",
    );
  });

  it("names the key of a wrong value, never the value", async () => {
    const config = await configOf("  api: { url: 'https://api.example.com/' }\n");

    const failing = () =>
      withOverrides(config, local({ api: { host: "", port: "secret-port-value" } }));

    expect(failing).toThrow(/services\.api\.host/);
    expect(failing).toThrow(/services\.api\.port/);
    expect(failing).not.toThrow(/secret-port-value/);
  });

  it("tells which keys come from local.yml", () => {
    const overrides = local({ api: { timeout: 3, port: 4000 } });

    expect(overriddenKeys(overrides, "api")).toEqual(["port", "timeout"]);
    expect(overriddenKeys(overrides, "web")).toEqual([]);
    expect(overriddenKeys(overrides, "constructor")).toEqual([]);
  });
});

describe("readServiceOverrides", () => {
  it("reads the values of each service, skip aside", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(
      paths.local,
      "services:\n  api:\n    port: 4000\n    skip: true\n  down:\n    skip: true\n",
    );

    expect(await readServiceOverrides(paths)).toEqual({
      at: "services",
      services: { api: { port: 4000 } },
    });
  });

  it("reads those of an environment under envs, and none of the local services", async () => {
    const root = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(
      root.local,
      "services:\n  api: { port: 4000 }\nenvs:\n  staging:\n    services:\n      api: { timeout: 9 }\n",
    );
    const paths = { ...root, environment: "staging" };

    expect(await readServiceOverrides(paths)).toEqual({
      at: "envs.staging.services",
      services: { api: { timeout: 9 } },
    });
  });

  it("reads none from a local.yml that is not valid YAML", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(paths.local, "services: [\n");

    expect((await readServiceOverrides(paths)).services).toEqual({});
  });
});
