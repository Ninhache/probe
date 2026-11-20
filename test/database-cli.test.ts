import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inheritedEnv, tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const SECRET = "Zq9-mk4p-sample";
const VARIABLE = "PROBE_DBCLI_PASSWORD";
const REFERENCE = `\${${VARIABLE}}`;

interface Run {
  code: number;
  output: string;
}

function probe(cwd: string, args: string[], path: string): Promise<Run> {
  return new Promise((done) => {
    const env: NodeJS.ProcessEnv = {
      ...inheritedEnv(),
      PROBE_NO_UPDATE_CHECK: "1",
      [VARIABLE]: SECRET,
      PATH: `${path}${delimiter}${process.env.PATH ?? ""}`,
    };
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env });
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output += chunk;
      });
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

// A psql that refuses the login and, like a careless client, names the password it got.
async function fakePsql(): Promise<string> {
  const bin = join(await tempDir(), "bin");
  await mkdir(bin);
  const file = join(bin, "psql");
  await writeFile(
    file,
    `#!${process.execPath}\nconsole.error("FATAL: refused " + process.env.PGPASSWORD); process.exit(2);\n`,
  );
  await chmod(file, 0o755);
  return bin;
}

async function project(): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".probe"));
  await writeFile(
    join(root, ".probe", "config.yml"),
    `schemaVersion: 1\nservices:\n  pg:\n    type: postgres\n    user: app\n    database: wakfuli\n    password: ${REFERENCE}\n`,
  );
  return root;
}

describe.skipIf(process.platform === "win32")("a database service on the command line", () => {
  it("never prints, writes or passes the password", async () => {
    const root = await project();
    const bin = await fakePsql();

    const runs = await Promise.all(
      [["check", "pg"], ["check", "pg", "--json"], ["ls"], ["curl", "pg"]].map((args) =>
        probe(root, args, bin),
      ),
    );

    expect(runs[0]?.code).toBe(1);
    expect(runs[0]?.output).toContain("refused");
    expect(runs[3]?.output).toContain(`PGPASSWORD="${REFERENCE}"`);
    for (const run of runs) expect(run.output).not.toContain(SECRET);
    for (const file of ["config.yml", "lock.yml"]) {
      const text = await readFile(join(root, ".probe", file), "utf8").catch(() => "");
      expect(text).not.toContain(SECRET);
    }
  });
});
