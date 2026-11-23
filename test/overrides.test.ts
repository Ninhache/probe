import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader";
import { readServiceOverrides } from "../src/config/local";
import {
  localMismatches,
  mismatchMessages,
  overriddenKeys,
  type ServiceOverrides,
  withOverrides,
} from "../src/config/overrides";
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

  it("leaves out a service config.yml does not have, as skip does", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(withOverrides(config, local({ gone: { port: 4000 } })).services).toEqual(
      config.services,
    );
  });

  it("refuses a host a url cannot take, without its value", async () => {
    const config = await configOf("  api: { url: 'https://api.example.com/' }\n");

    const failing = () => withOverrides(config, local({ api: { host: "marker-host:4000" } }));

    expect(failing).toThrow(/services\.api\.host: expected a host name alone/);
    expect(failing).not.toThrow(/marker-host/);
  });

  it.each([
    ["url", "http://marker-user:marker-pass@localhost/"],
    ["url", "ftp://marker.example.com/"],
    ["command", ""],
    ["port", "marker"],
  ])("names %s without its value when it is wrong", async (key, value) => {
    const config = await configOf(
      "  api: { port: 3000 }\n  worker: { type: command, command: 'true' }\n",
    );
    const name = key === "command" ? "worker" : "api";

    const failing = () => withOverrides(config, local({ [name]: { [key]: value } }));

    expect(failing).toThrow(new RegExp(`services\\.${name}\\.${key}`));
    expect(failing).not.toThrow(/marker/);
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

const adding = (
  extra: NonNullable<ServiceOverrides["extra"]>,
  at = "services",
): ServiceOverrides => ({ at, services: {}, extra });

describe("services added in local.yml", () => {
  it("checks a service only this machine has", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    const reached = withOverrides(config, adding({ scratch: { port: 5173, path: "/up" } }));

    expect(reached.services.scratch).toMatchObject({ host: "localhost", port: 5173, path: "/up" });
    expect(config.services.scratch).toBeUndefined();
  });

  it("checks the shared service when config.yml has one of the same name", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    const reached = withOverrides(config, adding({ api: { port: 4000 } }));

    expect(reached.services.api?.port).toBe(3000);
  });

  it("refuses a key the type of the added service does not read, without its value", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    const failing = () =>
      withOverrides(config, adding({ scratch: { port: 5173, user: "marker-user" } }));

    expect(failing).toThrow(/extraServices\.scratch\.user: needs `type: postgres`/);
    expect(failing).not.toThrow(/marker-user/);
  });

  it("refuses a password written there instead of a reference", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    const failing = () =>
      withOverrides(
        config,
        adding({ db: { type: "postgres", port: 5432, password: "marker-secret" } }),
      );

    expect(failing).toThrow(/extraServices\.db\.password/);
    expect(failing).not.toThrow(/marker-secret/);
  });

  it("refuses urls, which follow a parameter of the shared config", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(() =>
      withOverrides(config, adding({ web: { urls: { dev: "http://localhost/" } } })),
    ).toThrow(/extraServices\.web\.urls: cannot be set there/);
  });

  it("refuses a name config.yml could not have", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(() => withOverrides(config, adding({ "-bad": { port: 1 } }))).toThrow(
      /extraServices\.-bad: letters, digits/,
    );
  });

  it("names the added services of an environment under envs", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(() =>
      withOverrides(config, adding({ scratch: { port: "x" } }, "envs.staging.services")),
    ).toThrow(/envs\.staging\.extraServices\.scratch\.port/);
  });
});

describe("localMismatches", () => {
  it("tells the values and the skips of a service config.yml no longer has", async () => {
    const config = await configOf("  api: { port: 3000 }\n");
    const overrides: ServiceOverrides = {
      at: "services",
      services: { api: { port: 4000 }, gone: { port: 1 } },
      skipped: ["down"],
    };

    expect(localMismatches(config, overrides)).toEqual({ unused: ["down", "gone"], shadowed: [] });
  });

  it("tells an added service config.yml now has too", async () => {
    const config = await configOf("  api: { port: 3000 }\n");

    expect(localMismatches(config, adding({ api: { port: 1 }, scratch: { port: 2 } }))).toEqual({
      unused: [],
      shadowed: ["api"],
    });
  });

  it("finds none for the values of an added service", async () => {
    const config = await configOf("  api: { port: 3000 }\n");
    const overrides = {
      ...adding({ scratch: { port: 2 } }),
      services: { scratch: { timeout: 3 } },
    };

    expect(localMismatches(config, overrides)).toEqual({ unused: [], shadowed: [] });
  });

  it("says where each one is, with the prefix of the environment", () => {
    const overrides = adding({}, "envs.staging.services");

    expect(
      mismatchMessages(
        overrides,
        { unused: ["gone"], shadowed: ["api"] },
        ".probe/envs/staging.yml",
      ),
    ).toEqual([
      "local.yml: envs.staging.services.gone is no longer in .probe/envs/staging.yml: its values are unused. Remove them from .probe/local.yml.",
      "local.yml: envs.staging.extraServices.api is now in .probe/envs/staging.yml too: the shared one is checked. Move what differs to envs.staging.services.api, or remove it.",
    ]);
  });
});

describe("readServiceOverrides", () => {
  it("reads the services local.yml adds, in its scope", async () => {
    const root = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(
      root.local,
      "extraServices:\n  scratch: { port: 5173 }\nenvs:\n  staging:\n    extraServices:\n      tool: { port: 9 }\n",
    );

    expect((await readServiceOverrides(root)).extra).toEqual({ scratch: { port: 5173 } });
    expect((await readServiceOverrides({ ...root, environment: "staging" })).extra).toEqual({
      tool: { port: 9 },
    });
  });

  it("reads the values of each service, skip aside", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(
      paths.local,
      "services:\n  api:\n    port: 4000\n    skip: true\n  down:\n    skip: true\n",
    );

    expect(await readServiceOverrides(paths)).toEqual({
      at: "services",
      services: { api: { port: 4000 } },
      skipped: ["api", "down"],
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
