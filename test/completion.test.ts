import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import add from "../src/commands/add";
import { ADD_OPTION_KEYS } from "../src/commands/add-flags";
import check from "../src/commands/check";
import { fishScript } from "../src/completion/fish";
import { powershellScript } from "../src/completion/powershell";
import { type CommandSpec, completionSpec, SERVICE_COMMANDS, SHELLS } from "../src/completion/spec";
import { zshScript } from "../src/completion/zsh";
import { reference } from "../src/config/headers";
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

/** What zsh offers, without the descriptions `_describe` shows beside the options. */
async function zshOptions(cwd: string, ...words: string[]): Promise<string[]> {
  return (await zshCompletions(cwd, ...words)).map((line) => line.split(":")[0] as string);
}

const BARE: CommandSpec = {
  name: "",
  description: "",
  options: [],
  words: [],
  services: false,
  argument: false,
  byType: {},
};

const ADD_OPTIONS = [
  "--type",
  "--command",
  "--port",
  "--host",
  "--path",
  "--url",
  "--expect",
  "--contains",
  "--timeout",
  "--method",
  "--user",
  "--database",
  "--password",
  "--setenv",
  "--header",
  "--hint",
  "--tag",
  "--help",
];
const POSTGRES_OPTIONS = [
  "--type",
  "--port",
  "--host",
  "--timeout",
  "--user",
  "--database",
  "--password",
  "--hint",
  "--tag",
  "--help",
];
const COMMAND_OPTIONS = [
  "--type",
  "--command",
  "--timeout",
  "--setenv",
  "--hint",
  "--tag",
  "--help",
];
const sorted = (items: readonly string[]) => [...items].sort();

/** The cases every shell must complete the same way, given its own way to complete a command line. */
function completesLikeAdd(complete: (root: string, ...words: string[]) => Promise<string[]>) {
  it("offers the options once the name of add is typed, not before", async () => {
    const root = await project();

    expect(sorted(await complete(root, "probe", "add", "api", ""))).toEqual(sorted(ADD_OPTIONS));
    expect(await complete(root, "probe", "add", "")).not.toContain("--port");
  });

  it("offers only the options the type reads, without those given", async () => {
    const root = await project();
    const postgres = POSTGRES_OPTIONS.filter((option) => option !== "--type");
    const command = COMMAND_OPTIONS.filter((option) => option !== "--command");

    expect(sorted(await complete(root, "probe", "add", "db", "--type", "postgres", "--"))).toEqual(
      sorted(postgres),
    );
    expect(sorted(await complete(root, "probe", "add", "db", "--type=postgres", "--"))).toEqual(
      sorted(postgres),
    );
    expect(sorted(await complete(root, "probe", "add", "db", "--command", "x", "--"))).toEqual(
      sorted(command),
    );
  });

  it("offers a repeatable option again, not the others", async () => {
    const offered = await complete(
      await project(),
      "probe",
      "add",
      "api",
      "--port",
      "1",
      "--header",
      "a",
      "--",
    );

    expect(offered).toContain("--header");
    expect(offered).not.toContain("--port");
  });

  it("completes the methods after --method, and nothing after another value", async () => {
    const root = await project();

    expect(sorted(await complete(root, "probe", "add", "api", "--method", ""))).toEqual(
      sorted(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    );
    expect(await complete(root, "probe", "add", "api", "--port", "")).not.toContain("--host");
    expect(await complete(root, "probe", "add", "db", "--", "pg", "")).not.toContain("--port");
  });

  it("offers the options of a command without arguments", async () => {
    expect(sorted(await complete(await project(), "probe", "ls", ""))).toEqual([
      "--env",
      "--help",
      "--set",
    ]);
  });
}

describe("completionSpec", () => {
  const spec = completionSpec({ add, check });

  it("lists the long options of a command, not its positional arguments", () => {
    const options = spec.find(({ name }) => name === "add")?.options.map(({ name }) => name);

    expect(options).toEqual([
      "--type",
      "--command",
      "--port",
      "--host",
      "--path",
      "--url",
      "--expect",
      "--contains",
      "--timeout",
      "--method",
      "--user",
      "--database",
      "--password",
      "--setenv",
      "--header",
      "--hint",
      "--tag",
      "--help",
    ]);
  });

  it("describes each option, and says which take a value", () => {
    const options = spec.find(({ name }) => name === "check")?.options;

    expect(options).toContainEqual({
      name: "--json",
      description: expect.stringContaining("JSON"),
      value: false,
    });
    expect(options?.find(({ name }) => name === "--timeout")?.value).toBe(true);
    expect(options?.at(-1)).toEqual({ name: "--help", description: "Show help", value: false });
  });

  it("gives add the options each service type accepts", () => {
    const { byType } = spec.find(({ name }) => name === "add") as CommandSpec;

    expect(byType.postgres).toEqual(POSTGRES_OPTIONS);
    expect(byType.command).toEqual(COMMAND_OPTIONS);
    expect(byType.http).not.toContain("--setenv");
    expect(spec.find(({ name }) => name === "check")?.byType).toEqual({});
  });

  it("knows the key behind every option of add", () => {
    const options = Object.keys(add.args ?? {}).filter((name) => name !== "name");

    expect(options.filter((name) => !Object.hasOwn(ADD_OPTION_KEYS, name))).toEqual([]);
  });

  it("marks the commands whose options come after a free argument", () => {
    expect(spec.map(({ name, argument }) => [name, argument])).toEqual([
      ["add", true],
      ["check", false],
    ]);
  });

  it("marks the commands that take service names", () => {
    expect(spec.map(({ name, services }) => [name, services])).toEqual([
      ["add", false],
      ["check", true],
    ]);
  });
});

// A value add accepts for each option the completion offers to a postgres or a command service.
const SAMPLES: Record<string, string> = {
  "--port": "5432",
  "--host": "localhost",
  "--timeout": "3",
  "--user": "app",
  "--database": "app",
  "--password": reference("PG_PASSWORD"),
  "--command": "true",
  "--setenv": "A=1",
  "--hint": "run it",
  "--tag": "back",
};

describe("probe add", () => {
  it.each([
    ["postgres", POSTGRES_OPTIONS],
    ["command", COMMAND_OPTIONS],
  ])("accepts every option the completion offers to a %s service", async (type, options) => {
    const root = await project();
    const args = options
      .filter((option) => option !== "--help")
      .flatMap((option) => [option, option === "--type" ? type : (SAMPLES[option] as string)]);

    expect(await probe(root, "add", "svc", ...args)).toMatchObject({ code: 0, stderr: "" });
  });
});

describe("zshScript", () => {
  it("escapes what would end a description early", () => {
    const script = zshScript([{ ...BARE, name: "x", description: "it's a: b" }]);

    expect(script).toContain("'x:it'\\''s a\\: b'");
  });
});

describe("fishScript", () => {
  it("escapes a quote in a description", () => {
    const script = fishScript([{ ...BARE, name: "x", description: "it's" }]);

    expect(script).toContain("-a x -d 'it\\'s'");
  });
});

describe("powershellScript", () => {
  const script = powershellScript([
    {
      ...BARE,
      name: "x",
      description: "it's \u2018odd\u2019",
      options: [{ name: "--a", description: "the a", value: false }],
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
    expect(script).toContain("'x' = [ordered]@{ '--a' = 'the a' }");
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

    expect(stdout).toContain(
      `        ${SERVICE_COMMANDS.join("|")}) [ -z "$offer" ] || offer="services"`,
    );
    for (const command of SERVICE_COMMANDS) expect(stdout).toContain(`      ${command}) words="`);
  });
});

describe.skipIf(POSIX_ONLY)("bash completion", () => {
  completesLikeAdd(bashCompletions);

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

  it("completes the service types after --type", async () => {
    const root = await project();

    expect((await bashCompletions(root, "probe", "add", "db", "--type", "")).sort()).toEqual([
      "command",
      "http",
      "mysql",
      "postgres",
      "redis",
    ]);
    expect(await bashCompletions(root, "probe", "add", "db", "--type", "p")).toEqual(["postgres"]);
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

  it("completes the shells after completion", async () => {
    const root = await project();

    expect(await bashCompletions(root, "probe", "completion", "")).toEqual([
      "zsh",
      "bash",
      "fish",
      "powershell",
    ]);
  });

  it("offers no service outside a project", async () => {
    expect(await bashCompletions(await tempDir(), "probe", "check", "")).toEqual([]);
  });
});

describe.skipIf(withoutZsh)("zsh completion", () => {
  completesLikeAdd(zshOptions);

  it("describes the options", async () => {
    expect(await zshCompletions(await project(), "probe", "add", "api", "--p")).toContain(
      "--port:Port",
    );
  });

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

  it("completes the service types after --type", async () => {
    const root = await project();

    expect((await zshCompletions(root, "probe", "add", "db", "--type", "")).sort()).toEqual([
      "command",
      "http",
      "mysql",
      "postgres",
      "redis",
    ]);
  });

  it("offers the options of a command, and the shells after completion", async () => {
    const root = await project();

    expect(await zshOptions(root, "probe", "check", "--")).toEqual([
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
  completesLikeAdd((root, ...words) => fishCompletions(root, words.join(" ")));

  it("describes the options", async () => {
    const root = await project();
    const run = await exec(
      FISH as string,
      ["--no-config", "-c", "probe completion fish | source; complete -C 'probe add api --po'"],
      root,
      { PATH: await pathWithProbe() },
    );

    expect(run.stdout).toBe("--port\tPort\n");
  });

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

  it("completes the service types after --type", async () => {
    const root = await project();

    expect((await fishCompletions(root, "probe add db --type ")).sort()).toEqual([
      "command",
      "http",
      "mysql",
      "postgres",
      "redis",
    ]);
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
  completesLikeAdd((root, ...words) => powershellCompletions(root, words.join(" ")));

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

  it("completes the service types after --type", async () => {
    const root = await project();

    expect((await powershellCompletions(root, "probe add db --type ")).sort()).toEqual([
      "command",
      "http",
      "mysql",
      "postgres",
      "redis",
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
    // PowerShell falls back to file names when a completer offers nothing: only probe's own words are ruled out.
    expect(await powershellCompletions(root, "probe ls ")).not.toContain("api");
  });
});
