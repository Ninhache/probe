import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { Config } from "../src/config/schema";
import { oncePass } from "../src/dashboard/native/once";
import { tempProject } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const ANSI = "\u001b[";

const plain = { isTTY: false, color: false, columns: 80, hyperlinks: false, unicode: true };
const config = { schemaVersion: 1, services: {} } as Config;

const result = (name: string, ok: boolean, extra: Partial<CheckResult> = {}): CheckResult => ({
  name,
  type: "http",
  ok,
  target: `http://${name}`,
  latencyMs: 4,
  status: ok ? 200 : undefined,
  ...(ok ? {} : { error: "connection refused" }),
  ...extra,
});

const pass = (results: CheckResult[], more: object = {}) =>
  oncePass({
    config,
    variables: {} as never,
    skipped: new Set(),
    selection: {},
    timeoutMs: 1000,
    environments: [],
    terminal: plain,
    empty: "No services yet.",
    run: async () => results,
    ...more,
  });

describe("one pass", () => {
  it("prints a table and is not down when every service is up or skipped", async () => {
    const { text, down } = await pass([
      result("api", true),
      result("db", true, { skipped: true, status: undefined }),
    ]);

    expect(down).toBe(false);
    expect(text).toContain("api");
    expect(text).toContain("skipped");
    expect(text).not.toContain(ANSI);
  });

  it("is down when one service is", async () => {
    const { text, down } = await pass([result("api", true), result("web", false)]);

    expect(down).toBe(true);
    expect(text).toContain("connection refused");
  });

  it("says so when there is nothing to check", async () => {
    expect(await pass([])).toEqual({ text: "No services yet.", down: false });
  });

  it("names each environment once there are some", async () => {
    const source = {
      name: "prod",
      file: ".probe/envs/prod.yml",
      load: async () => ({ config, variables: {} as never, skipped: new Set<string>() }),
    };
    const { text } = await pass([result("api", true)], { environments: [source] });

    expect(text).toContain("local");
    expect(text).toContain("prod");
  });

  it("draws colours only for a terminal that has them", async () => {
    const colored = await pass([result("api", true)], { terminal: { ...plain, color: true } });

    expect(colored.text).toContain(ANSI);
  });
});

describe("probe off a terminal and with --once", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_, response) => response.end("ok"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  const probe = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
    new Promise<{ code: number; stdout: string }>((done) => {
      execFile(
        process.execPath,
        [CLI, ...args],
        { cwd, env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", ...env } },
        (error, stdout) => {
          done({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout });
        },
      );
    });

  const project = (servicePort: number) =>
    tempProject(
      `schemaVersion: 1\nservices:\n  api: { host: 127.0.0.1, port: ${servicePort}, path: / }\n`,
    );

  it("checks once when piped, with no colour code, and exits 0 when all is up", async () => {
    const { dir } = await project(port);
    const run = await probe(dir.replace(/\/\.probe$/, ""), []);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("api");
    expect(run.stdout).not.toContain(ANSI);
  });

  it("exits 1 when a service is down, as probe check does", async () => {
    const closed = await new Promise<number>((done) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as AddressInfo;
        probe.close(() => done(free));
      });
    });
    const { dir } = await project(closed);
    const run = await probe(dir.replace(/\/\.probe$/, ""), ["--once"]);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("connection refused");
  });

  it("keeps NO_COLOR out of the table even when asked for colour", async () => {
    const { dir } = await project(port);
    const run = await probe(dir.replace(/\/\.probe$/, ""), ["--once"], {
      NO_COLOR: "1",
      FORCE_COLOR: "1",
    });

    expect(run.stdout).not.toContain(ANSI);
  });
});
