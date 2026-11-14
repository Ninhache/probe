import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir, tempProject } from "./helpers";
import { CTRL_C, ENTER, hasPython, onTerminal } from "./terminal";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "S3CRET";
const ENV = `API_URL=http://user:${SECRET}@localhost:4000/health?token=${SECRET}\nSTRIPE_KEY=${SECRET}\n`;
const LIST = "Services found here";
const SPACE = " ";
const EMPTY_CONFIG = "schemaVersion: 1\nservices: {}\n";

/** A directory with a `.env`, written here: `.env` files are never committed. */
async function withEnv(): Promise<string> {
  const root = await tempDir();
  await writeFile(join(root, ".env"), ENV);
  return root;
}

const configOf = (root: string) => readFile(join(root, ".probe", "config.yml"), "utf8");

describe.skipIf(!hasPython())("probe init on a terminal", () => {
  it("should add the ticked services, with their source shown", async () => {
    const root = await withEnv();

    const { code, screen } = await onTerminal(root, ["init"], [[LIST, `${SPACE}${ENTER}`]]);

    expect(screen).toContain(".env (API_URL)");
    expect(screen).toContain("Added api.");
    expect(code).toBe(0);
    expect(await configOf(root)).toContain("api: { port: 4000, path: /health }");
  });

  it("should show the source of every line, not only the one under the cursor", async () => {
    const root = await withEnv();
    await writeFile(join(root, "package.json"), '{"name":"shop","scripts":{"dev":"vite"}}');

    const { screen } = await onTerminal(root, ["init"], [[LIST, CTRL_C]]);

    const list = screen.slice(0, screen.indexOf("Enter: confirm"));
    expect(list).toContain(".env (API_URL)");
    expect(list).toContain("package.json (dev script)");
  });

  it("should propose a local port where a server answers", async () => {
    const server = createServer((_request, response) => response.end());
    await new Promise<void>((done) => server.listen(0, "localhost", done));
    const port = (server.address() as AddressInfo).port;

    const { screen } = await onTerminal(await tempDir(), ["init"], [[LIST, CTRL_C]], {
      PROBE_DETECT_PORTS: String(port),
    });
    await new Promise((done) => server.close(done));

    expect(screen).toContain(`answers on localhost:${port}`);
  });

  it("should show and write no other value of .env", async () => {
    const root = await withEnv();

    const { screen } = await onTerminal(root, ["init"], [[LIST, `${SPACE}${ENTER}`]]);

    expect(screen).not.toContain(SECRET);
    expect(await configOf(root)).not.toContain(SECRET);
  });

  it("should add nothing when Enter is pressed alone", async () => {
    const root = await withEnv();

    const { code, screen } = await onTerminal(root, ["init"], [[LIST, ENTER]]);

    expect(screen).toContain("Next: probe add api -p 3000");
    expect(code).toBe(0);
    expect(await configOf(root)).toContain("services: {}");
  });

  it("should say what it always said when nothing is found", async () => {
    const { code, screen } = await onTerminal(await tempDir(), ["init"], []);

    expect(screen).not.toContain(LIST);
    expect(screen).toContain("Created .probe/.");
    expect(screen).toContain("Next: probe add api -p 3000");
    expect(code).toBe(0);
  });
});

describe.skipIf(!hasPython())("probe add alone on a terminal, with services found", () => {
  async function projectWithEnv() {
    const { root, config } = await tempProject(EMPTY_CONFIG);
    await writeFile(join(root, ".env"), ENV);
    return { root, config };
  }

  it("should add the ticked services without asking more", async () => {
    const { root, config } = await projectWithEnv();

    const { code, screen } = await onTerminal(root, ["add"], [[LIST, `${SPACE}${ENTER}`]]);

    expect(screen).not.toContain("Service name");
    expect(code).toBe(0);
    expect(await readFile(config, "utf8")).toContain("api: { port: 4000, path: /health }");
  });

  it("should go on to the questions when nothing is ticked", async () => {
    const { root, config } = await projectWithEnv();

    const { screen } = await onTerminal(
      root,
      ["add"],
      [
        [LIST, ENTER],
        ["Service name", CTRL_C],
      ],
    );

    expect(screen).toContain("Nothing added.");
    expect(await readFile(config, "utf8")).toBe(EMPTY_CONFIG);
  });

  it("should write nothing when the list is cancelled", async () => {
    const { root, config } = await projectWithEnv();

    const { screen } = await onTerminal(root, ["add"], [[LIST, CTRL_C]]);

    expect(screen).toContain("Nothing added.");
    expect(await readFile(config, "utf8")).toBe(EMPTY_CONFIG);
  });
});

describe("probe init off a terminal", () => {
  it("should ask nothing, try no port and write an empty config", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end();
    });
    await new Promise<void>((done) => server.listen(0, "localhost", done));
    const root = await withEnv();
    const env = {
      ...process.env,
      PROBE_NO_UPDATE_CHECK: "1",
      PROBE_DETECT_PORTS: String((server.address() as AddressInfo).port),
    };

    const stdout = await new Promise<string>((done) => {
      execFile(process.execPath, [CLI, "init"], { cwd: root, env }, (_error, out) => done(out));
    });
    await new Promise((done) => server.close(done));

    expect(stdout).toBe("Created .probe/. Next: probe add api -p 3000\n");
    expect(requests).toBe(0);
    expect(await configOf(root)).toContain("services: {}");
  });
});
