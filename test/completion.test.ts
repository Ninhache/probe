import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import add from "../src/commands/add";
import check from "../src/commands/check";
import { completionSpec, SERVICE_COMMANDS } from "../src/completion/spec";
import { zshScript } from "../src/completion/zsh";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
/** The system bash: 3.2 on macOS, the oldest one the script must run on. */
const BASH = "/bin/bash";
const CONFIG = "schemaVersion: 1\nservices:\n  api: { port: 3000 }\n  front: { port: 5173 }\n";

function onPath(binary: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, binary))
    .find((file) => existsSync(file));
}

const ZSH = onPath("zsh");
// zsh ships with macOS: there the tests must run. Elsewhere they run when zsh is installed.
const withoutZsh = !ZSH && process.platform !== "darwin";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function exec(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Run> {
  return new Promise((done) => {
    execFile(
      file,
      args,
      { cwd, env: { ...process.env, PROBE_NO_UPDATE_CHECK: "1", ...env } },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        done({ code: typeof code === "number" ? code : 1, stdout, stderr });
      },
    );
  });
}

const probe = (cwd: string, ...args: string[]) => exec(process.execPath, [CLI, ...args], cwd);

async function project(config = CONFIG): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".probe"));
  await writeFile(join(root, ".probe", "config.yml"), config);
  return root;
}

/** A PATH whose `probe` is the built CLI, as the scripts call it by that name. */
async function pathWithProbe(): Promise<string> {
  const bin = await tempDir();
  const shim = join(bin, "probe");
  await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  await chmod(shim, 0o755);
  return `${bin}${delimiter}${process.env.PATH}`;
}

/** What bash offers for the words typed so far, the last one being the word under the cursor. */
async function bashCompletions(cwd: string, ...words: string[]): Promise<string[]> {
  const script = [
    'eval "$(probe completion bash)"',
    `COMP_WORDS=(${words.map((word) => `'${word}'`).join(" ")})`,
    `COMP_CWORD=${words.length - 1}`,
    "_probe",
    `printf "%s\\n" "\${COMPREPLY[@]}"`,
  ].join("\n");
  const run = await exec(BASH, ["-c", script], cwd, { PATH: await pathWithProbe() });
  expect(run).toMatchObject({ code: 0, stderr: "" });
  return run.stdout.split("\n").filter(Boolean);
}

// The completion builtins only exist while zsh completes: these print what they are given.
const ZSH_STUBS = [
  "compdef() { : }",
  `compadd() { if [[ $1 == -a ]]; then print -l -- "\${(@P)2}"; else shift; print -l -- "$@"; fi }`,
  `_describe() { print -l -- "\${(@P)2}" }`,
];

/** What the zsh function hands to zsh for the words typed so far. */
async function zshCompletions(cwd: string, ...words: string[]): Promise<string[]> {
  const script = [
    ...ZSH_STUBS,
    'eval "$(probe completion zsh)"',
    `words=(${words.map((word) => `'${word}'`).join(" ")})`,
    `CURRENT=${words.length}`,
    "_probe",
  ].join("\n");
  const run = await exec(ZSH as string, ["-f", "-c", script], cwd, { PATH: await pathWithProbe() });
  expect(run).toMatchObject({ code: 0, stderr: "" });
  return run.stdout.split("\n").filter(Boolean);
}

describe("completionSpec", () => {
  const spec = completionSpec({ add, check });

  it("lists the long options of a command, not its positional arguments", () => {
    const options = spec.find(({ name }) => name === "add")?.options;

    expect(options).toEqual(["--port", "--host", "--path", "--expect", "--timeout", "--help"]);
  });

  it("marks the commands that take service names", () => {
    expect(spec.map(({ name, services }) => [name, services])).toEqual([
      ["add", false],
      ["check", true],
    ]);
  });
});

describe("zshScript", () => {
  it("escapes what would end a description early", () => {
    const script = zshScript([
      { name: "x", description: "it's a: b", options: [], words: [], services: false },
    ]);

    expect(script).toContain("'x:it'\\''s a\\: b'");
  });
});

describe("probe __complete services", () => {
  it("prints one service name per line", async () => {
    expect(await probe(await project(), "__complete", "services")).toEqual({
      code: 0,
      stdout: "api\nfront\n",
      stderr: "",
    });
  });

  it("finds the project from a sub-directory", async () => {
    const root = await project();
    await mkdir(join(root, "src", "deep"), { recursive: true });

    const run = await probe(join(root, "src", "deep"), "__complete", "services");

    expect(run.stdout).toBe("api\nfront\n");
  });

  it.each([
    ["outside a project", undefined],
    ["with a config that is not YAML", "services: [api\n"],
    ["with a config without services", "schemaVersion: 1\n"],
  ])("prints nothing and exits 0 %s", async (_, config) => {
    const root = config === undefined ? await tempDir() : await project(config);

    expect(await probe(root, "__complete", "services")).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("leaves out a key a shell would run or expand", async () => {
    const root = await project(
      'schemaVersion: 1\nservices:\n  api: { port: 1 }\n  "$(touch pwned)": { port: 2 }\n  "a b": { port: 3 }\n  "*": { port: 4 }\n',
    );

    expect((await probe(root, "__complete", "services")).stdout).toBe("api\n");
    expect(await bashCompletions(root, "probe", "check", "")).toEqual(["api"]);
    expect(existsSync(join(root, "pwned"))).toBe(false);
  });

  it("lists the names of a config another probe version wrote, and leaves the file alone", async () => {
    const config = "schemaVersion: 99\nservices:\n  api: { port: 1, unknown: true }\n";
    const root = await project(config);

    expect((await probe(root, "__complete", "services")).stdout).toBe("api\n");
    expect(await readFile(join(root, ".probe", "config.yml"), "utf8")).toBe(config);
  });
});

describe("probe completion", () => {
  it.each(["zsh", "bash"])(
    "prints the %s script outside a project, with nothing on stderr",
    async (shell) => {
      const run = await probe(await tempDir(), "completion", shell);

      expect(run).toMatchObject({ code: 0, stderr: "" });
      expect(run.stdout).toContain("_probe()");
    },
  );

  it("exits 2 for a shell without completion, and names the supported ones", async () => {
    expect(await probe(await tempDir(), "completion", "tcsh")).toEqual({
      code: 2,
      stdout: "",
      stderr: 'probe: no completion for the shell "tcsh". Supported: zsh, bash.\n',
    });
  });

  it("completes service names only for commands that exist", async () => {
    const { stdout } = await probe(await tempDir(), "completion", "bash");

    expect(stdout).toContain(`      ${SERVICE_COMMANDS.join("|")}) words=`);
    for (const command of SERVICE_COMMANDS) expect(stdout).toContain(`      ${command}) words="`);
  });
});

describe("bash completion", () => {
  it("is valid for the system bash", async () => {
    const root = await tempDir();
    await writeFile(join(root, "probe.bash"), (await probe(root, "completion", "bash")).stdout);

    expect(await exec(BASH, ["-n", "probe.bash"], root)).toMatchObject({ code: 0, stderr: "" });
  });

  it("completes a command", async () => {
    const root = await project();

    expect(await bashCompletions(root, "probe", "ch")).toEqual(["check"]);
    expect(await bashCompletions(root, "probe", "")).toContain("completion");
  });

  it.each(SERVICE_COMMANDS)("completes the service names after %s", async (command) => {
    const root = await project();

    expect(await bashCompletions(root, "probe", command, "")).toEqual(["api", "front"]);
    expect(await bashCompletions(root, "probe", command, "f")).toEqual(["front"]);
  });

  it("completes the options of a command", async () => {
    const root = await project();

    expect(await bashCompletions(root, "probe", "check", "--")).toEqual([
      "--json",
      "--timeout",
      "--help",
    ]);
    expect(await bashCompletions(root, "probe", "check", "api", "--j")).toEqual(["--json"]);
  });

  it("completes the shells after completion, and nothing after a command without arguments", async () => {
    const root = await project();

    expect(await bashCompletions(root, "probe", "completion", "")).toEqual(["zsh", "bash"]);
    expect(await bashCompletions(root, "probe", "ls", "")).toEqual([]);
  });

  it("offers no service outside a project", async () => {
    expect(await bashCompletions(await tempDir(), "probe", "check", "")).toEqual([]);
  });
});

describe.skipIf(withoutZsh)("zsh completion", () => {
  it("is valid zsh", async () => {
    const root = await tempDir();
    await writeFile(join(root, "_probe"), (await probe(root, "completion", "zsh")).stdout);

    expect(await exec(ZSH as string, ["-n", "_probe"], root)).toMatchObject({
      code: 0,
      stderr: "",
    });
  });

  it("loads without compinit, with nothing printed", async () => {
    const run = await exec(
      ZSH as string,
      ["-f", "-c", 'eval "$(probe completion zsh)"'],
      await tempDir(),
      {
        PATH: await pathWithProbe(),
      },
    );

    expect(run).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("describes the commands", async () => {
    const offered = await zshCompletions(await project(), "probe", "");

    expect(offered).toContain("check:Check that services respond (all of them by default)");
    expect(offered).toContain("completion:Print the shell completion script (zsh, bash)");
  });

  it.each(SERVICE_COMMANDS)("offers the service names after %s", async (command) => {
    expect(await zshCompletions(await project(), "probe", command, "")).toEqual(["api", "front"]);
  });

  it("offers the options of a command, and the shells after completion", async () => {
    const root = await project();

    expect(await zshCompletions(root, "probe", "check", "--")).toEqual([
      "--json",
      "--timeout",
      "--help",
    ]);
    expect(await zshCompletions(root, "probe", "completion", "")).toEqual(["zsh", "bash"]);
    expect(await zshCompletions(root, "probe", "ls", "")).toEqual([]);
  });
});
