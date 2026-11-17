import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ServiceFields, writeService } from "../src/commands/service-writes";
import { loadConfig } from "../src/config/loader";
import { makefilePath, syncMakefile } from "../src/makefile/sync";
import { tempProject } from "./helpers";

const CONFIG = [
  "schemaVersion: 1",
  "services:",
  "  # the backend",
  "  api: { host: localhost, port: 3000, path: /health, timeout: 10 } # slow to start",
  "  front: { port: 5173 }",
  "",
].join("\n");

const fields = (over: Partial<ServiceFields> = {}): ServiceFields => ({
  host: "localhost",
  port: 3000,
  path: "/health",
  expect: undefined,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("writeService", () => {
  it("should add a service with only the keys that are not at their default", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeService(paths, {
      kind: "add",
      name: "admin",
      fields: { host: "localhost", port: 8080, path: "/", expect: [200, 204] },
    });

    expect(written?.config.services.admin).toMatchObject({ port: 8080, expect: [200, 204] });
    const text = await readFile(paths.config, "utf8");
    expect(text).toContain("# the backend");
    expect(text).toMatch(/admin:\s*\n?\s*\{?\s*port: 8080/);
    expect(text).not.toMatch(/admin:[^\n]*host/);
  });

  it("should leave a one-status list as written when the edit gives the same status", async () => {
    const config = CONFIG.replace("front: { port: 5173 }", "front: { port: 5173, expect: [200] }");
    const paths = await tempProject(config);

    await writeService(paths, {
      kind: "edit",
      name: "front",
      fields: { host: "localhost", port: 5174, path: "/", expect: 200 },
    });

    const text = await readFile(paths.config, "utf8");
    expect(text).toContain("port: 5174");
    // Still a list: the YAML writer may only space it differently.
    expect(text).toMatch(/expect: \[ ?200 ?\]/);
  });

  it("should write nothing when the service to add already exists", async () => {
    const paths = await tempProject(CONFIG);

    expect(await writeService(paths, { kind: "add", name: "api", fields: fields() })).toBeNull();
    expect(await readFile(paths.config, "utf8")).toBe(CONFIG);
  });

  it("should change only the edited key, keeping comments, timeout and explicit defaults", async () => {
    const paths = await tempProject(CONFIG);

    await writeService(paths, { kind: "edit", name: "api", fields: fields({ port: 3001 }) });

    expect(await readFile(paths.config, "utf8")).toBe(CONFIG.replace("port: 3000", "port: 3001"));
  });

  it("should keep the hint of a service that is edited", async () => {
    const config = CONFIG.replace(
      "front: { port: 5173 }",
      "front: { port: 5173, hint: run make front }",
    );
    const paths = await tempProject(config);

    await writeService(paths, {
      kind: "edit",
      name: "front",
      fields: fields({ port: 5174, path: "/" }),
    });

    expect(await readFile(paths.config, "utf8")).toBe(config.replace("port: 5173", "port: 5174"));
  });

  it("should keep the tags of a service that is edited", async () => {
    const config = CONFIG.replace(
      "front: { port: 5173 }",
      "front: { port: 5173, tags: [web, infra] }",
    );
    const paths = await tempProject(config);

    await writeService(paths, {
      kind: "edit",
      name: "front",
      fields: fields({ port: 5174, path: "/" }),
    });

    expect(await readFile(paths.config, "utf8")).toContain(
      "front: { port: 5174, tags: [ web, infra ] }",
    );
  });

  it("should keep the text a service must contain when it is edited", async () => {
    const contains = `contains: '"status":"ok"'`;
    const config = CONFIG.replace("front: { port: 5173 }", `front: { port: 5173, ${contains} }`);
    const paths = await tempProject(config);

    await writeService(paths, {
      kind: "edit",
      name: "front",
      fields: fields({ port: 5174, path: "/" }),
    });

    expect(await readFile(paths.config, "utf8")).toContain(`front: { port: 5174, ${contains} }`);
  });

  it("should keep the headers of a service that is edited", async () => {
    const headers = "headers: { Accept: text/plain, X-Api-Key: '$" + "{API_KEY}' }";
    const config = CONFIG.replace("front: { port: 5173 }", `front: { port: 5173, ${headers} }`);
    const paths = await tempProject(config);

    await writeService(paths, {
      kind: "edit",
      name: "front",
      fields: {
        host: "localhost",
        port: 5174,
        path: "/",
        expect: undefined,
        headers: { Accept: "text/plain", "X-Api-Key": "$" + "{API_KEY}" },
      },
    });

    expect(await readFile(paths.config, "utf8")).toBe(config.replace("5173", "5174"));
  });

  it("should write the headers an edit adds, and drop the key with the last one", async () => {
    const paths = await tempProject(CONFIG);
    const edit = (headers: ServiceFields["headers"]) =>
      writeService(paths, { kind: "edit", name: "api", fields: fields({ headers }) });

    const added = await edit({ Authorization: "Bearer $" + "{API_TOKEN}" });
    expect(added?.config.services.api?.headers).toEqual({
      Authorization: "Bearer $" + "{API_TOKEN}",
    });
    expect(await readFile(paths.config, "utf8")).toContain("timeout: 10");

    await edit(undefined);
    expect(await readFile(paths.config, "utf8")).toBe(CONFIG);
  });

  it("should refuse a secret in clear, leaving the file as it was", async () => {
    const paths = await tempProject(CONFIG);

    await expect(
      writeService(paths, {
        kind: "edit",
        name: "api",
        fields: fields({ headers: { Authorization: "Bearer s3cr3t-value" } }),
      }),
    ).rejects.toThrow();
    expect(await readFile(paths.config, "utf8")).toBe(CONFIG);
  });

  it("should drop a key that an edit puts back to its default", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeService(paths, {
      kind: "edit",
      name: "api",
      fields: fields({ path: "/" }),
    });

    expect(written?.config.services.api?.path).toBe("/");
    expect(await readFile(paths.config, "utf8")).not.toContain("path:");
  });

  it("should write the method an edit gives, and drop the key when it goes back to GET", async () => {
    const paths = await tempProject(CONFIG);

    await writeService(paths, { kind: "edit", name: "api", fields: fields({ method: "POST" }) });
    expect(await readFile(paths.config, "utf8")).toContain("method: POST");

    await writeService(paths, { kind: "edit", name: "api", fields: fields({ method: "GET" }) });
    expect(await readFile(paths.config, "utf8")).toBe(CONFIG);
  });

  it.each([
    ["method: post", "POST"],
    ["method: GET", undefined],
    ["method: GET", "GET"],
  ] as const)(
    "should leave a hand-written `%s` as it is when the edit keeps the method",
    async (written, method) => {
      const config = CONFIG.replace("front: { port: 5173 }", `front: { port: 5173, ${written} }`);
      const paths = await tempProject(config);

      await writeService(paths, {
        kind: "edit",
        name: "front",
        fields: { host: "localhost", port: 5174, path: "/", expect: undefined, method },
      });

      expect(await readFile(paths.config, "utf8")).toBe(config.replace("5173", "5174"));
    },
  );

  it("should write nothing when the service to edit is no longer there", async () => {
    const paths = await tempProject(CONFIG);

    expect(await writeService(paths, { kind: "edit", name: "gone", fields: fields() })).toBeNull();
  });

  it("should remove a service and leave the others as they are", async () => {
    const paths = await tempProject(CONFIG);

    const written = await writeService(paths, { kind: "remove", name: "front" });

    expect(Object.keys(written?.config.services ?? {})).toEqual(["api"]);
    expect(await readFile(paths.config, "utf8")).toBe(
      CONFIG.replace("  front: { port: 5173 }\n", ""),
    );
  });

  it("should write nothing when the service to remove is no longer there", async () => {
    const paths = await tempProject(CONFIG);

    expect(await writeService(paths, { kind: "remove", name: "gone" })).toBeNull();
  });

  it("should keep an edit made to the file since the dashboard opened", async () => {
    const paths = await tempProject(CONFIG);
    await writeFile(paths.config, CONFIG.replace("port: 5173", "port: 5174"));

    await writeService(paths, { kind: "remove", name: "api" });

    expect(await readFile(paths.config, "utf8")).toContain("port: 5174");
  });

  it("should regenerate the Makefile block when the project has one", async () => {
    const paths = await tempProject(CONFIG);
    await syncMakefile(paths, (await loadConfig(paths)).config);

    const written = await writeService(paths, { kind: "remove", name: "front" });

    expect(written?.warning).toBeUndefined();
    expect(await readFile(makefilePath(paths), "utf8")).not.toContain("check-front");
  });

  it("should return the warning, printing nothing, when the Makefile block was edited by hand", async () => {
    const paths = await tempProject(CONFIG);
    await syncMakefile(paths, (await loadConfig(paths)).config);
    const makefile = await readFile(makefilePath(paths), "utf8");
    await writeFile(makefilePath(paths), makefile.replace("check-front", "check-mine"));
    const printed = vi.spyOn(console, "error").mockImplementation(() => {});

    const written = await writeService(paths, { kind: "remove", name: "front" });

    expect(written?.warning).toContain("probe sync");
    expect(printed).not.toHaveBeenCalled();
    expect(await readFile(makefilePath(paths), "utf8")).toContain("check-mine");
  });

  it("should write the address of each value under urls and remove the ones emptied", async () => {
    const paths = await tempProject(
      [
        "schemaVersion: 1",
        "parameters:",
        "  env: { values: [dev, prod], strategy: { kind: url } }",
        "services:",
        "  # the backend",
        "  api: { port: 3000, urls: { prod: 'https://example.com/health' } }",
        "",
      ].join("\n"),
    );
    const edit = (urls: Record<string, string>) =>
      writeService(paths, { kind: "edit", name: "api", fields: fields({ path: "/" }), urls });

    const written = await edit({
      dev: "http://localhost:3001",
      prod: "https://example.com/health",
    });
    expect(written?.config.services.api?.urls).toEqual({
      dev: "http://localhost:3001",
      prod: "https://example.com/health",
    });
    expect(await readFile(paths.config, "utf8")).toContain("# the backend");

    const emptied = await edit({ dev: "", prod: "" });
    expect(emptied?.config.services.api?.urls).toBeUndefined();
    expect(await readFile(paths.config, "utf8")).not.toContain("urls");
  });
});
