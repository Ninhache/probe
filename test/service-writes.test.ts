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
});
