import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import add from "../src/commands/add";
import check from "../src/commands/check";
import { fishScript } from "../src/completion/fish";
import { powershellScript } from "../src/completion/powershell";
import { completionSpec, SERVICE_COMMANDS, SHELLS } from "../src/completion/spec";
import { zshScript } from "../src/completion/zsh";
import { tempDir } from "./helpers";

const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");
const BASH = "/bin/bash";
// The bash tests drive a POSIX shell and a `probe` sh shim: the runner's bash.exe is WSL or Git Bash, not a stable target.
const POSIX_ONLY = process.platform === "win32";
const CONFIG = "schemaVersion: 1\nservices:\n  api: { port: 3000 }\n  front: { port: 5173 }\n";

function onPath(binary: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, binary))
    .find((file) => existsSync(file));
}

const ZSH = onPath("zsh");
const FISH = onPath("fish");
const PWSH = onPath(process.platform === "win32" ? "pwsh.exe" : "pwsh");
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

const ENVIRONMENTS = ["local", "dev", "prod"];

async function projectWithEnvironments(): Promise<string> {
  const root = await project();
  await mkdir(join(root, ".probe", "envs"));
  for (const name of ["prod", "dev"]) {
    await writeFile(join(root, ".probe", "envs", `${name}.yml`), CONFIG);
  }
  return root;
}

const TAGGED =
  "schemaVersion: 1\nservices:\n  api: { port: 3000, tags: [back, infra] }\n  db: { port: 5432, tags: [back] }\n";

async function projectWithTags(): Promise<string> {
  const root = await project();
  await writeFile(join(root, ".probe", "config.yml"), TAGGED);
  return root;
}

async function pathWithProbe(): Promise<string> {
  const bin = await tempDir();
  const shim = join(bin, "probe");
  await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  await chmod(shim, 0o755);
  return `${bin}${delimiter}${process.env.PATH}`;
}

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

    expect(options).toEqual([
      "--command",
      "--port",
      "--host",
      "--path",
      "--url",
      "--expect",
      "--contains",
      "--timeout",
      "--method",
      "--header",
      "--hint",
      "--tag",
      "--help",
    ]);
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

describe("fishScript", () => {
  it("escapes a quote in a description", () => {
    const script = fishScript([
      { name: "x", description: "it's", options: [], words: [], services: false },
    ]);

    expect(script).toContain("-a x -d 'it\\'s'");
  });
});

describe("powershellScript", () => {
  const script = powershellScript([
    {
      name: "x",
      description: "it's \u2018odd\u2019",
      options: ["--a"],
      words: ["w"],
      services: true,
    },
  ]);

  it("registers a native completer for probe", () => {
    expect(script).toContain("Register-ArgumentCompleter -Native -CommandName probe");
  });

  it("doubles every quote of a description", () => {
    expect(script).toContain("'x' = 'it''s \u2018\u2018odd\u2019\u2019'");
  });

  it("lists the options, the words and the commands with services from the spec", () => {
    expect(script).toContain("'x' = @('--a')");
    expect(script).toContain("'x' = @('w')");
    expect(script).toContain("$withServices = @('x')");
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
    if (!POSIX_ONLY) expect(await bashCompletions(root, "probe", "check", "")).toEqual(["api"]);
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
  it.each(SHELLS)(
    "prints the %s script outside a project, with nothing on stderr",
    async (shell) => {
      const run = await probe(await tempDir(), "completion", shell);

      expect(run).toMatchObject({ code: 0, stderr: "" });
      expect(run.stdout).toContain(`# ${shell} completion for probe`);
    },
  );

  it("exits 2 for a shell without completion, and names the supported ones", async () => {
    expect(await probe(await tempDir(), "completion", "tcsh")).toEqual({
      code: 2,
      stdout: "",
      stderr:
        'probe: no completion for the shell "tcsh". Supported: zsh, bash, fish, powershell.\n',
    });
  });

  it("completes service names only for commands that exist", async () => {
    const { stdout } = await probe(await tempDir(), "completion", "bash");

    expect(stdout).toContain(`      ${SERVICE_COMMANDS.join("|")}) words=`);
    for (const command of SERVICE_COMMANDS) expect(stdout).toContain(`      ${command}) words="`);
  });
});

describe.skipIf(POSIX_ONLY)("bash completion", () => {
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

  it("completes the environments after --env", async () => {
    const root = await projectWithEnvironments();

    expect(await bashCompletions(root, "probe", "check", "--env", "")).toEqual(ENVIRONMENTS);
    expect(await bashCompletions(root, "probe", "ls", "--env", "p")).toEqual(["prod"]);
  });

  it("completes the tags after --tag, not the services", async () => {
    const root = await projectWithTags();

    expect(await bashCompletions(root, "probe", "check", "--tag", "")).toEqual(["back", "infra"]);
    expect(await bashCompletions(root, "probe", "wait", "--tag", "i")).toEqual(["infra"]);
  });

  it("completes the options of a command", async () => {
    const root = await project();

    expect(await bashCompletions(root, "probe", "check", "--")).toEqual([
      "--json",
      "--env",
      "--tag",
      "--set",
      "--timeout",
      "--help",
    ]);
    expect(await bashCompletions(root, "probe", "check", "api", "--j")).toEqual(["--json"]);
  });

  it("completes the shells after completion, and nothing after a command without arguments", async () => {
    const root = await project();

    expect(await bashCompletions(root, "probe", "completion", "")).toEqual([
      "zsh",
      "bash",
      "fish",
      "powershell",
    ]);
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
    expect(offered).toContain(
      "completion:Print the shell completion script (zsh, bash, fish, powershell)",
    );
  });

  it.each(SERVICE_COMMANDS)("offers the service names after %s", async (command) => {
    expect(await zshCompletions(await project(), "probe", command, "")).toEqual(["api", "front"]);
  });

  it("completes the environments after --env", async () => {
    const root = await projectWithEnvironments();

    expect(await zshCompletions(root, "probe", "check", "--env", "")).toEqual(ENVIRONMENTS);
    expect(await zshCompletions(root, "probe", "check", "api", "--env", "")).toEqual(ENVIRONMENTS);
  });

  it("completes the tags after --tag, not the services", async () => {
    const root = await projectWithTags();

    expect(await zshCompletions(root, "probe", "check", "--tag", "")).toEqual(["back", "infra"]);
  });

  it("offers the options of a command, and the shells after completion", async () => {
    const root = await project();

    expect(await zshCompletions(root, "probe", "check", "--")).toEqual([
      "--json",
      "--env",
      "--tag",
      "--set",
      "--timeout",
      "--help",
    ]);
    expect(await zshCompletions(root, "probe", "completion", "")).toEqual([
      "zsh",
      "bash",
      "fish",
      "powershell",
    ]);
    expect(await zshCompletions(root, "probe", "ls", "")).toEqual([]);
  });
});

async function fishCompletions(cwd: string, line: string): Promise<string[]> {
  const script = `probe completion fish | source; complete -C '${line}'`;
  const run = await exec(FISH as string, ["--no-config", "-c", script], cwd, {
    PATH: await pathWithProbe(),
  });
  expect(run).toMatchObject({ code: 0, stderr: "" });
  return run.stdout
    .split("\n")
    .filter(Boolean)
    .map((candidate) => candidate.split("\t")[0] as string);
}

// fish ships with no system: these run where it is installed (the Linux jobs of the CI install it).
describe.skipIf(!FISH)("fish completion", () => {
  it("is valid fish", async () => {
    const root = await tempDir();
    await writeFile(join(root, "probe.fish"), (await probe(root, "completion", "fish")).stdout);

    expect(await exec(FISH as string, ["--no-execute", "probe.fish"], root)).toMatchObject({
      code: 0,
      stderr: "",
    });
  });

  it("completes a command, with its description", async () => {
    const root = await project();
    const run = await exec(
      FISH as string,
      ["--no-config", "-c", "probe completion fish | source; complete -C 'probe ch'"],
      root,
      { PATH: await pathWithProbe() },
    );

    expect(run.stdout).toBe("check\tCheck that services respond (all of them by default)\n");
  });

  it("offers every command and no file name before a command", async () => {
    const root = await project();
    await writeFile(join(root, "some-file"), "");

    const offered = await fishCompletions(root, "probe ");

    expect(offered).toContain("completion");
    expect(offered).not.toContain("some-file");
  });

  it.each(SERVICE_COMMANDS)("offers the service names after %s", async (command) => {
    const root = await project();

    expect((await fishCompletions(root, `probe ${command} `)).sort()).toEqual(["api", "front"]);
    expect(await fishCompletions(root, `probe ${command} f`)).toEqual(["front"]);
  });

  it("completes the environments after --env", async () => {
    const root = await projectWithEnvironments();

    expect((await fishCompletions(root, "probe check --env ")).sort()).toEqual(
      [...ENVIRONMENTS].sort(),
    );
  });

  it("completes the tags after --tag, not the services", async () => {
    const root = await projectWithTags();

    expect((await fishCompletions(root, "probe check --tag ")).sort()).toEqual(["back", "infra"]);
  });

  it("offers the options of a command, and the shells after completion", async () => {
    const root = await project();

    expect((await fishCompletions(root, "probe check --")).sort()).toEqual([
      "--env",
      "--help",
      "--json",
      "--set",
      "--tag",
      "--timeout",
    ]);
    expect((await fishCompletions(root, "probe completion ")).sort()).toEqual([
      "bash",
      "fish",
      "powershell",
      "zsh",
    ]);
    expect(await fishCompletions(root, "probe ls ")).toEqual([]);
  });

  it("offers no service outside a project", async () => {
    expect(await fishCompletions(await tempDir(), "probe check ")).toEqual([]);
  });
});

async function powershellEnv(): Promise<NodeJS.ProcessEnv> {
  const bin = await tempDir();
  const cache = await tempDir();
  if (process.platform === "win32") {
    await writeFile(join(bin, "probe.cmd"), `@"${process.execPath}" "${CLI}" %*\r\n`);
  } else {
    const shim = join(bin, "probe");
    await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
    await chmod(shim, 0o755);
  }
  const inherited = ["SystemRoot", "TEMP", "TMP", "PATHEXT"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  );
  return {
    ...Object.fromEntries(inherited),
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    HOME: cache,
    XDG_CACHE_HOME: cache,
    USERPROFILE: cache,
    LOCALAPPDATA: cache,
  };
}

async function powershellCompletions(cwd: string, line: string): Promise<string[]> {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "probe completion powershell | Out-String | Invoke-Expression",
    `(TabExpansion2 -inputScript '${line}' -cursorColumn ${line.length}).CompletionMatches | ForEach-Object { $_.CompletionText }`,
  ].join("; ");
  const env = await powershellEnv();
  const run = await new Promise<Run>((done) => {
    execFile(
      PWSH as string,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { cwd, env },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        done({ code: typeof code === "number" ? code : 1, stdout, stderr });
      },
    );
  });
  expect(run).toMatchObject({ code: 0, stderr: "" });
  return run.stdout.split(/\r?\n/).filter(Boolean);
}

describe.skipIf(!PWSH)("powershell completion", () => {
  it("completes a command", async () => {
    expect(await powershellCompletions(await project(), "probe ch")).toEqual(["check"]);
    expect(await powershellCompletions(await project(), "probe ")).toContain("completion");
  });

  it.each(SERVICE_COMMANDS)("offers the service names after %s", async (command) => {
    const root = await project();

    expect((await powershellCompletions(root, `probe ${command} `)).sort()).toEqual([
      "api",
      "front",
    ]);
    expect(await powershellCompletions(root, `probe ${command} f`)).toEqual(["front"]);
  });

  it("leaves out a key a shell would run or expand", async () => {
    const root = await project(
      'schemaVersion: 1\nservices:\n  api: { port: 1 }\n  "$(touch pwned)": { port: 2 }\n  "a b": { port: 3 }\n  "*": { port: 4 }\n',
    );

    expect(await powershellCompletions(root, "probe check ")).toEqual(["api"]);
    expect(existsSync(join(root, "pwned"))).toBe(false);
  });

  it("completes the environments after --env", async () => {
    const root = await projectWithEnvironments();

    expect((await powershellCompletions(root, "probe check --env ")).sort()).toEqual(
      [...ENVIRONMENTS].sort(),
    );
  });

  it("completes the tags after --tag, not the services", async () => {
    const root = await projectWithTags();

    expect((await powershellCompletions(root, "probe check --tag ")).sort()).toEqual([
      "back",
      "infra",
    ]);
  });

  it("offers the options of a command, and the shells after completion", async () => {
    const root = await project();

    expect((await powershellCompletions(root, "probe check --")).sort()).toEqual([
      "--env",
      "--help",
      "--json",
      "--set",
      "--tag",
      "--timeout",
    ]);
    expect((await powershellCompletions(root, "probe completion ")).sort()).toEqual([
      "bash",
      "fish",
      "powershell",
      "zsh",
    ]);
    expect(await powershellCompletions(root, "probe ls ")).toEqual([]);
  });
});
