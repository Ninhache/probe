import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { commandChecker, commandTarget, shellCommand } from "../src/checkers/command";
import { getServiceType, serviceType } from "../src/checkers/registry";
import { runChecks } from "../src/checkers/run";
import { configSchemaV1, type Service } from "../src/config/schema";
import { tempDir } from "./helpers";

const NODE = process.execPath;
const node = (script: string, ...args: string[]) => [NODE, "-e", script, ...args];

const service = (command: Service["command"], timeout?: number): Service =>
  ({ type: "command", command, ...(timeout === undefined ? {} : { timeout }) }) as Service;

const check = (command: Service["command"], context: { timeoutMs?: number; cwd?: string } = {}) =>
  commandChecker.check("job", service(command), { timeoutMs: 10_000, ...context });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("the command checker", () => {
  it("should report up with its exit code when the command exits 0", async () => {
    const result = await check(node("process.exit(0)"));

    expect(result).toMatchObject({ type: "command", ok: true, exitCode: 0 });
    expect(result.status).toBeUndefined();
  });

  it("should report the last line of stderr when the command exits with another code", async () => {
    const result = await check(
      node("console.error('first'); console.error('boom'); process.exit(3)"),
    );

    expect(result).toMatchObject({ ok: false, exitCode: 3, error: "boom" });
  });

  it("should strip ANSI sequences and trailing blank lines from the reason", async () => {
    const script =
      "process.stderr.write('first\\n\\x1b[31mred boom\\x1b[0m\\n\\n');process.exit(1)";

    expect((await check(node(script))).error).toBe("red boom");
  });

  it("should say the exit code when stderr is empty", async () => {
    expect((await check(node("process.exit(4)"))).error).toBe("exit 4");
  });

  it("should cut a long reason and keep reading past the stderr cap", async () => {
    const script =
      "process.stderr.write('x'.repeat(1_000_000) + '\\n' + 'y'.repeat(500), () => process.exit(1))";

    const { error } = await check(node(script));

    expect(error).toMatch(/^y+…$/);
    expect(Array.from(error as string)).toHaveLength(200);
  });

  it("should say the program was not found for a list", async () => {
    const result = await check(["probe-no-such-program-4d1e"]);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("command not found: probe-no-such-program-4d1e");
    expect(result.exitCode).toBeUndefined();
  });

  it("should run a string through the system shell", async () => {
    expect(await check("exit 0")).toMatchObject({ ok: true, exitCode: 0 });
    expect(await check("exit 3")).toMatchObject({ ok: false, exitCode: 3, error: "exit 3" });
  });

  it("should run a string that quotes its program", async () => {
    const result = await check(`"${NODE}" -e "process.exit(0)"`);

    expect(result.ok).toBe(true);
  });

  it("should run in the directory it is given", async () => {
    const dir = await realpath(await tempDir());
    const script =
      "const f=require('node:fs');process.exit(f.realpathSync(process.cwd())===f.realpathSync(process.argv[1])?0:1)";

    expect((await check(node(script, dir), { cwd: dir })).ok).toBe(true);
  });

  it("should not read from stdin", async () => {
    const script = "process.stdin.on('end',()=>process.exit(0));process.stdin.resume()";

    expect((await check(node(script))).ok).toBe(true);
  });

  it("should time out a command that hangs", async () => {
    const result = await check(node("setInterval(()=>{},1000)"), { timeoutMs: 200 });

    expect(result).toMatchObject({ ok: false, error: "timeout after 0.2s" });
    expect(result.exitCode).toBeUndefined();
    expect(result.hint).toContain("timeout");
  });

  it("should kill what the command started when it times out", async () => {
    const dir = await realpath(await tempDir());
    const pidFile = join(dir, "grandchild.pid");
    // The grandchild ends by itself: a failing test must not leave it running.
    const script = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
      require("node:fs").writeFileSync(process.argv[1], String(child.pid));
      setInterval(() => {}, 1000);`;

    const result = await check(node(script, pidFile), { timeoutMs: 2_000 });

    expect(result.error).toBe("timeout after 2s");
    const pid = Number(await readFile(pidFile, "utf8"));
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
  });

  it("should stop when the signal aborts", async () => {
    const controller = new AbortController();
    const running = commandChecker.check("job", service(node("setInterval(()=>{},1000)")), {
      timeoutMs: 10_000,
      signal: controller.signal,
    });

    controller.abort();

    expect((await running).error).toBe("aborted");
  });

  it("should not start when the signal has already aborted", async () => {
    const result = await commandChecker.check("job", service(node("process.exit(0)")), {
      timeoutMs: 10_000,
      signal: AbortSignal.abort(),
    });

    expect(result).toMatchObject({ ok: false, error: "aborted" });
  });

  it("should settle once when a process it left behind holds stderr open", async () => {
    const script = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: ["ignore", "ignore", "inherit"] }).unref();
      process.exit(0);`;

    const started = Date.now();
    const result = await check(node(script));

    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});

describe("the command service type", () => {
  it("should be the one the registry gives a service that has `type: command`", () => {
    expect(getServiceType("command")).toBe(commandChecker);
    expect(serviceType(service(["a"]))).toBe(commandChecker);
  });

  it("should show a list as typed, quoting a word that has a space", () => {
    expect(commandTarget(["docker", "compose", "exec", "-T", "db", "pg_isready"])).toBe(
      "docker compose exec -T db pg_isready",
    );
    expect(commandTarget(["echo", "a b"])).toBe('echo "a b"');
    expect(commandTarget("redis-cli ping")).toBe("redis-cli ping");
  });

  it("should copy a list as a command a POSIX shell runs the same way", () => {
    expect(shellCommand(["echo", "a b", "it's", "$HOME", "plain-1.0"])).toBe(
      "echo 'a b' 'it'\\''s' '$HOME' plain-1.0",
    );
    expect(shellCommand("redis-cli ping")).toBe("redis-cli ping");
  });

  it("should have nothing to open and no parameter to take", () => {
    expect(commandChecker.open).toBeUndefined();
    expect(commandChecker.parameterKinds).toBeUndefined();
  });

  it("should check through runChecks with the project root as directory", async () => {
    const dir = await realpath(await tempDir());
    await writeFile(join(dir, "ready"), "");
    const config = configSchemaV1.parse({
      schemaVersion: 1,
      services: {
        ready: {
          type: "command",
          command: node("process.exit(require('node:fs').existsSync('ready') ? 0 : 1)"),
        },
        missing: { type: "command", command: node("process.exit(1)") },
      },
    });

    const results = await runChecks(config, [], { timeoutMs: 10_000, cwd: dir });

    expect(results.map(({ name, ok, exitCode }) => ({ name, ok, exitCode }))).toEqual([
      { name: "ready", ok: true, exitCode: 0 },
      { name: "missing", ok: false, exitCode: 1 },
    ]);
  });

  it("should use the timeout of the service", async () => {
    const config = configSchemaV1.parse({
      schemaVersion: 1,
      services: {
        slow: { type: "command", command: node("setInterval(()=>{},1000)"), timeout: 0.2 },
      },
    });

    const [result] = await runChecks(config, [], { timeoutMs: 10_000 });

    expect(result?.error).toBe("timeout after 0.2s");
  });
});
