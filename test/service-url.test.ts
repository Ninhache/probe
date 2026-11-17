import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { curlCommand, targetUrl } from "../src/checkers/http";
import { createSystemTrust } from "../src/checkers/system-ca";
import { writeService } from "../src/commands/service-writes";
import { configSchemaV1, serviceSchemaV1, urlProblem } from "../src/config/schema";
import { addressFields } from "../src/config/service-input";
import { address } from "../src/detect/shared";
import { tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "hunter2";
const WITH_PASSWORD = `https://admin:${SECRET}@localhost:8443/health`;

const issues = (service: object) => {
  const result = serviceSchemaV1.safeParse(service);
  return result.success ? [] : result.error.issues.map((issue) => [issue.path, issue.message]);
};

describe("a service declared by `url`", () => {
  it("has the host, port and path of its URL", () => {
    expect(serviceSchemaV1.parse({ url: "https://api.test:8443/health?deep=1" })).toEqual({
      url: "https://api.test:8443/health?deep=1",
      host: "api.test",
      port: 8443,
      path: "/health?deep=1",
    });
  });

  it.each([
    ["https://api.test", 443],
    ["http://api.test/", 80],
  ])("takes the port of the scheme when %s names none", (url, port) => {
    expect(serviceSchemaV1.parse({ url })).toMatchObject({ port, path: "/" });
  });

  it("keeps `expect` and `timeout`", () => {
    const service = serviceSchemaV1.parse({ url: "https://api.test", expect: 204, timeout: 10 });

    expect(service).toMatchObject({ expect: 204, timeout: 10 });
  });

  it("is requested and shown as written", () => {
    const service = serviceSchemaV1.parse({ url: "https://api.test:8443/health" });

    expect(targetUrl(service)).toBe("https://api.test:8443/health");
    expect(curlCommand(service)).toBe("curl -i -L --max-time 3 'https://api.test:8443/health'");
  });

  it.each(["host", "port", "path"] as const)("refuses `%s` next to it", (key) => {
    const extra = { host: "api.test", port: 8443, path: "/health" }[key];

    expect(issues({ url: "https://api.test", [key]: extra })).toEqual([
      [[key], "cannot be set together with `url`, which already says it"],
    ]);
  });

  it.each(["ftp://api.test", "localhost:8443", "/health", "https://", ""])(
    "refuses %j, which is not an http or https URL",
    (url) => {
      expect(issues({ url })).toEqual([
        [["url"], "expected an http:// or https:// URL, e.g. https://localhost:8443/health"],
      ]);
    },
  );

  it("refuses a user or a password, without repeating them", () => {
    const found = issues({ url: WITH_PASSWORD });

    expect(found).toEqual([[["url"], "expected a URL without a user or a password"]]);
    expect(urlProblem("https://admin@localhost")).toBe("a URL without a user or a password");
  });
});

describe("a service declared by `port`", () => {
  it("reads as before", () => {
    expect(serviceSchemaV1.parse({ port: 3000 })).toEqual({
      host: "localhost",
      port: 3000,
      path: "/",
    });
  });

  it("still needs its port, said the same way", () => {
    expect(issues({ path: "/health" })).toEqual([
      [["port"], "Invalid input: expected number, received undefined"],
    ]);
  });

  it("names the service in the path of a config problem", () => {
    const result = configSchemaV1.safeParse({ schemaVersion: 1, services: { api: {} } });

    expect(result.error?.issues[0]?.path).toEqual(["services", "api", "port"]);
  });
});

describe("address", () => {
  it("is where the URL of a service points, default port included", () => {
    expect(address({ url: "https://localhost:8443/health" })).toBe("localhost:8443");
    expect(address({ url: "https://api.test/" })).toBe("api.test:443");
    expect(address({ url: "http://api.test/" })).toBe("api.test:80");
    expect(address({ port: 3000 })).toBe("localhost:3000");
  });
});

describe("createSystemTrust", () => {
  const store = () => ({
    getCACertificates: vi.fn((type: "default" | "system") => [`${type}-ca`]),
    setDefaultCACertificates: vi.fn(),
  });

  it("adds the system store to what Node trusts, once, and only when asked", async () => {
    const tls = store();
    const trust = createSystemTrust(async () => tls);

    expect(trust.tried).toBe(false);
    expect(tls.getCACertificates).not.toHaveBeenCalled();
    expect(await Promise.all([trust.load(), trust.load()])).toEqual([true, true]);
    expect(trust.tried).toBe(true);
    expect(tls.setDefaultCACertificates).toHaveBeenCalledExactlyOnceWith([
      "default-ca",
      "system-ca",
    ]);
  });

  it("changes nothing on a Node that cannot", async () => {
    expect(await createSystemTrust(async () => ({})).load()).toBe(false);
  });

  it("leaves the checks as they are when the store cannot be read", async () => {
    const tls = store();
    tls.getCACertificates.mockImplementation(() => {
      throw new Error("no store");
    });

    expect(await createSystemTrust(async () => tls).load()).toBe(false);
    expect(tls.setDefaultCACertificates).not.toHaveBeenCalled();
  });
});

describe("writeService", () => {
  const URL_CONFIG = "schemaVersion: 1\nservices:\n  api: { url: https://localhost:8443/health }\n";
  const urlFields = {
    url: "https://localhost:8443/health",
    host: "localhost",
    port: 8443,
    path: "/health",
  };

  it("should keep only `url` when a service declared by it gets another field", async () => {
    const paths = await tempProject(URL_CONFIG);

    await writeService(paths, { kind: "edit", name: "api", fields: { ...urlFields, expect: 204 } });

    expect(await readFile(paths.config, "utf8")).toBe(
      "schemaVersion: 1\nservices:\n  api: { url: https://localhost:8443/health, expect: 204 }\n",
    );
  });

  it("should leave an http `url` as it is when only another field changes", async () => {
    const paths = await tempProject(
      "schemaVersion: 1\nservices:\n  api: { url: http://localhost:3000/health }\n",
    );
    const fields = addressFields("http://localhost:3000/health");

    await writeService(paths, { kind: "edit", name: "api", fields: { ...fields, expect: 204 } });

    expect(await readFile(paths.config, "utf8")).toBe(
      "schemaVersion: 1\nservices:\n  api: { url: http://localhost:3000/health, expect: 204 }\n",
    );
  });

  it("should replace `url` with a host and a port", async () => {
    const paths = await tempProject(URL_CONFIG);

    await writeService(paths, {
      kind: "edit",
      name: "api",
      fields: { host: "localhost", port: 9000, path: "/", expect: undefined },
    });

    expect(await readFile(paths.config, "utf8")).toBe(
      "schemaVersion: 1\nservices:\n  api:\n    port: 9000\n",
    );
  });

  it("should replace host, port and path with a `url`", async () => {
    const paths = await tempProject(
      "schemaVersion: 1\nservices:\n  api: { port: 3000, path: /up }\n",
    );

    await writeService(paths, { kind: "edit", name: "api", fields: urlFields });

    expect(await readFile(paths.config, "utf8")).toBe(
      "schemaVersion: 1\nservices:\n  api:\n    url: https://localhost:8443/health\n",
    );
  });

  it("should add a service by its `url` alone", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");

    await writeService(paths, { kind: "add", name: "api", fields: urlFields });

    expect(await readFile(paths.config, "utf8")).toContain(
      "api: { url: https://localhost:8443/health }",
    );
  });
});

describe("probe add --url", () => {
  const probe = (cwd: string, ...args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      execFile(
        process.execPath,
        [CLI, ...args],
        { cwd, env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1" } },
        (error, stdout, stderr) => {
          const code = (error as { code?: number } | null)?.code;
          done({ code: error ? (typeof code === "number" ? code : 1) : 0, stdout, stderr });
        },
      );
    });
  const project = async () => (await tempProject("schemaVersion: 1\nservices:\n")).root;
  const config = (root: string) => readFile(resolve(root, ".probe", "config.yml"), "utf8");

  it("declares the service by its URL, and nothing else", async () => {
    const root = await project();

    const added = await probe(root, "add", "api", "--url", "https://localhost:8443/health");

    expect(added).toMatchObject({ code: 0, stderr: "" });
    expect(await config(root)).toMatch(
      /api:\s*\{?\s*url: https:\/\/localhost:8443\/health\s*\}?\n/,
    );
    expect((await probe(root, "ls")).stdout).toBe("api  https://localhost:8443/health\n");
  });

  it("refuses a password without writing or showing it", async () => {
    const root = await project();

    const added = await probe(root, "add", "api", "--url", WITH_PASSWORD);

    expect(added.code).toBe(2);
    expect(added.stderr).toContain("--url expects a URL without a user or a password.");
    expect(added.stdout + added.stderr).not.toContain(SECRET);
    expect(await config(root)).not.toContain("api");
  });

  it.each([
    ["--port", "3000"],
    ["--host", "api.test"],
    ["--path", "/health"],
  ])("refuses %s next to it", async (flag, value) => {
    const root = await project();

    const added = await probe(root, "add", "api", "--url", "https://localhost", flag, value);

    expect(added.code).toBe(2);
    expect(added.stderr).toContain(`remove ${flag}.`);
  });

  it("asks for a port or a URL when neither is given off a terminal", async () => {
    const added = await probe(await project(), "add", "api", "--path", "/health");

    expect(added.code).toBe(2);
    expect(added.stderr).toContain("--port 3000, or --url https://localhost:8443/health");
  });

  it("says what is wrong in a config that mixes `url` and `port`", async () => {
    const paths = await tempProject(
      "schemaVersion: 1\nservices:\n  api: { url: https://localhost:8443, port: 8443 }\n",
    );

    const checked = await probe(paths.root, "check");

    expect(checked.code).toBe(2);
    expect(checked.stderr).toContain(
      "services.api.port: cannot be set together with `url`, which already says it",
    );
  });
});
