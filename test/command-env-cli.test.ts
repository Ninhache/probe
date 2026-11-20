import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inheritedEnv, tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "Zq9-mk4p-sample";
const VARIABLE = "PROBE_ENVCLI_PASSWORD";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function probe(cwd: string, args: string[], { stdin = "" } = {}): Promise<Run> {
  return new Promise((done) => {
    const env: NodeJS.ProcessEnv = { ...inheritedEnv(), PROBE_NO_UPDATE_CHECK: "1" };
    delete env[VARIABLE];
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

async function project(): Promise<string> {
  const root = await tempDir();
  await probe(root, ["init"]);
  return root;
}

const config = (root: string) => readFile(join(root, ".probe", "config.yml"), "utf8");

// Fails the way a database does: it names the password it was refused.
const SCRIPT = `console.error("denied for " + process.env.DB_PWD); process.exit(1)`;

async function withService(root: string): Promise<void> {
  const text = await config(root);
  await writeFile(
    join(root, ".probe", "config.yml"),
    `${text.replace(/services:[\s\S]*$/, "")}services:\n  db:\n    type: command\n    command: [${JSON.stringify(process.execPath)}, -e, ${JSON.stringify(SCRIPT)}]\n    env:\n      DB_PWD: \${${VARIABLE}}\n`,
  );
}

describe("probe add --setenv", () => {
  it("writes the variables given and says which one to set next", async () => {
    const root = await project();

    const run = await probe(root, [
      "add",
      "db",
      "--command",
      "mysqladmin ping",
      "--setenv",
      "MYSQL_HOST=127.0.0.1",
      `--setenv=MYSQL_PWD=\${${VARIABLE}}`,
    ]);

    expect(run).toMatchObject({
      code: 0,
      stdout: `Added db. It needs ${VARIABLE}, not set yet: probe var ${VARIABLE}\n`,
    });
    expect(await config(root)).toContain(
      `env:\n      MYSQL_HOST: 127.0.0.1\n      MYSQL_PWD: \${${VARIABLE}}\n`,
    );
  });

  it("refuses a secret written as is, without repeating it or writing anything", async () => {
    const root = await project();
    const before = await config(root);

    const run = await probe(root, [
      "add",
      "db",
      "--command",
      "x",
      "--setenv",
      `MYSQL_PWD=${SECRET}`,
    ]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--setenv MYSQL_PWD expects a reference instead of the secret");
    expect(run.stdout + run.stderr).not.toContain(SECRET);
    expect(await config(root)).toBe(before);
  });

  it("refuses an env without a command", async () => {
    const root = await project();

    const run = await probe(root, ["add", "api", "-p", "3000", "--setenv", "A=b"]);

    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--setenv sets the environment of a command");
  });
});

describe("a command with an env", () => {
  it("masks the value its stderr echoes, in the text and in --json", async () => {
    const root = await project();
    await withService(root);
    await probe(root, ["var", VARIABLE], { stdin: `${SECRET}\n` });

    const text = await probe(root, ["check", "db"]);
    const json = await probe(root, ["check", "db", "--json"]);

    expect(text.code).toBe(1);
    expect(text.stdout).toContain(`denied for \${${VARIABLE}}`);
    expect(json.stdout).toContain(`denied for \${${VARIABLE}}`);
    for (const output of [text, json]) expect(output.stdout + output.stderr).not.toContain(SECRET);
  });

  it("lists the names it sets, never a value", async () => {
    const root = await project();
    await withService(root);
    await probe(root, ["var", VARIABLE], { stdin: `${SECRET}\n` });

    const listing = await probe(root, ["ls"]);

    expect(listing.stdout).toContain("sets DB_PWD");
    expect(listing.stdout + listing.stderr).not.toContain(SECRET);
    expect(listing.stdout).not.toContain(VARIABLE);
  });

  it("does not run while the variable is not set, and lists it under probe var", async () => {
    const root = await project();
    await withService(root);

    const run = await probe(root, ["check", "db"]);
    const listing = await probe(root, ["var"]);

    expect(run.stdout).toContain(`${VARIABLE} is not set`);
    expect(run.stdout).toContain(`probe var ${VARIABLE}`);
    expect(listing.stdout).toBe(`${VARIABLE}  not set: probe var ${VARIABLE}  (used by db)\n`);
  });
});
