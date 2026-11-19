import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { Config } from "../src/config/schema";
import { diagnoseServices, endpointOf } from "../src/doctor/diagnose";
import { formatDiagnosis } from "../src/doctor/format";
import {
  type CommandResult,
  listenerOwners,
  parseDockerInspect,
  parseLsof,
  parseSs,
  publishingContainers,
  type RunCommand,
  runCommand,
  tcpConnect,
} from "../src/doctor/system";
import { currentPlatform, platformFor } from "../src/platform";
import { createColors } from "../src/ui/colors";

const plain = createColors(false);
const noExecutable = async () => undefined;
const done = (stdout: string, code = 0): CommandResult => ({ state: "done", code, stdout });

function fakeRun(answers: Record<string, CommandResult>): RunCommand & { calls: string[][] } {
  const calls: string[][] = [];
  const run = async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    const key = command === "docker" ? `docker ${args[0]}` : command;
    return answers[key] ?? { state: "missing" as const };
  };
  return Object.assign(run, { calls });
}

const down = (name: string, port: number): CheckResult => ({
  name,
  type: "http",
  ok: false,
  target: `http://localhost:${port}/`,
  latencyMs: 1,
  error: "connection refused",
});

const config = (services: Record<string, object>): Config =>
  ({ schemaVersion: 1, services }) as unknown as Config;

const LSOF = "p4242\ncnode\nf21\nn127.0.0.1:3000\nf22\nn[::1]:3000\np77\ncpostgres\nf5\nn*:5432\n";
const INSPECT = [
  '/demo-db|exited|{"5432/tcp":[{"HostIp":"","HostPort":"5432"}]}',
  '/demo-cache|running|{"6379/tcp":[{"HostIp":"127.0.0.1","HostPort":"6380"}]}',
  "/demo-worker|running|{}",
  '/demo-dns|exited|{"53/udp":[{"HostIp":"","HostPort":"53"}]}',
  "/demo-job|created|null",
].join("\n");

describe("parsers", () => {
  it("reads the process of each listening port from lsof", () => {
    const owners = parseLsof(LSOF);
    expect(owners.get(3000)).toEqual({ name: "node", pid: 4242 });
    expect(owners.get(5432)).toEqual({ name: "postgres", pid: 77 });
    expect(owners.size).toBe(2);
  });

  it("reads ss, leaving out the sockets whose owner it does not show", () => {
    const owners = parseSs(
      [
        'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=4242,fd=21))',
        "LISTEN 0 4096 0.0.0.0:6379 0.0.0.0:*",
        'LISTEN 0 511 [::1]:5173 [::]:* users:(("vite",pid=9,fd=3))',
      ].join("\n"),
    );
    expect([...owners]).toEqual([
      [3000, { name: "node", pid: 4242 }],
      [5173, { name: "vite", pid: 9 }],
    ]);
  });

  it("keeps the containers that publish a TCP port, stopped ones included", () => {
    expect(parseDockerInspect(INSPECT)).toEqual([
      { name: "demo-db", state: "exited", ports: [5432] },
      { name: "demo-cache", state: "running", ports: [6380] },
    ]);
  });

  it("splits a target into host and port", () => {
    expect(endpointOf("http://localhost:3000/health")).toEqual({
      host: "localhost",
      port: 3000,
      local: true,
    });
    expect(endpointOf("https://[::1]/")).toEqual({ host: "::1", port: 443, local: true });
    expect(endpointOf("https://api.example.com/")?.local).toBe(false);
  });
});

describe("lookups", () => {
  it("falls back on ss when lsof is missing on Linux", async () => {
    const run = fakeRun({ ss: done('LISTEN 0 1 *:3000 *:* users:(("node",pid=1,fd=2))') });
    const lookup = await listenerOwners(run, platformFor("linux"));
    expect(lookup.state === "done" && lookup.owners.get(3000)?.name).toBe("node");
  });

  it("skips the owner when lsof is missing, without trying ss on macOS", async () => {
    const run = fakeRun({});
    expect(await listenerOwners(run, platformFor("darwin"))).toEqual({
      state: "skipped",
      reason: "lsof not found",
    });
    expect(run.calls.map(([command]) => command)).toEqual(["lsof"]);
  });

  it("reads what lsof printed even when it exits 1", async () => {
    const lookup = await listenerOwners(fakeRun({ lsof: done("", 1) }), platformFor("linux"));
    expect(lookup).toEqual({ state: "done", owners: new Map() });
  });

  it("tells docker missing from docker not answering from no container", async () => {
    expect(await publishingContainers(fakeRun({}))).toEqual({
      state: "skipped",
      reason: "docker not found",
    });
    const silent = await publishingContainers(fakeRun({ "docker ps": done("", 1) }));
    expect(silent.state).toBe("skipped");
    expect(await publishingContainers(fakeRun({ "docker ps": done("") }))).toEqual({
      state: "done",
      containers: [],
    });
  });

  it("asks docker for the name, the state and the port bindings only", async () => {
    const run = fakeRun({ "docker ps": done("a1\nb2\n"), "docker inspect": done(INSPECT) });
    await publishingContainers(run);
    expect(run.calls[1]).toEqual([
      "docker",
      "inspect",
      "--format",
      "{{.Name}}|{{.State.Status}}|{{json .HostConfig.PortBindings}}",
      "a1",
      "b2",
    ]);
  });
});

describe("diagnoseServices", () => {
  const services = config({
    api: { host: "localhost", port: 3000, path: "/" },
    db: { host: "localhost", port: 5432, path: "/" },
    web: { host: "localhost", port: 5173, path: "/" },
  });
  const up: CheckResult = {
    name: "web",
    type: "http",
    ok: true,
    target: "http://localhost:5173/",
    status: 200,
    latencyMs: 3,
  };

  it("names the process on the port and the stopped container that publishes it", async () => {
    const run = fakeRun({
      lsof: done(LSOF),
      "docker ps": done("a1\n"),
      "docker inspect": done(INSPECT),
    });
    const reports = await diagnoseServices(services, [down("api", 3000), down("db", 5432), up], {
      run,
      connect: async (_host, port) => port === 3000,
      executable: noExecutable,
      platform: platformFor("linux"),
    });
    expect(reports[0]?.checks).toEqual({
      port: { status: "listening" },
      process: { status: "found", name: "node", pid: 4242 },
      docker: { status: "none" },
    });
    expect(reports[1]?.checks).toEqual({
      port: { status: "closed" },
      process: { status: "none" },
      docker: { status: "stopped", containers: [{ name: "demo-db", state: "exited" }] },
    });
    expect(reports[2]).toEqual(up);
    expect(formatDiagnosis(reports[0] as never, plain).join("\n")).toContain(
      "node (pid 4242) listens on it",
    );
    expect(formatDiagnosis(reports[1] as never, plain).join("\n")).toContain(
      "container demo-db (exited) publishes this port → docker start demo-db",
    );
  });

  it("prefers the name of the executable to the one lsof gives", async () => {
    const [report] = await diagnoseServices(services, [down("api", 3000)], {
      run: fakeRun({ lsof: done("p4242\ncMainThread\nn*:3000\n") }),
      connect: async () => true,
      executable: async (pid) => (pid === 4242 ? "node" : undefined),
      platform: platformFor("linux"),
    });
    expect(report?.checks?.process).toEqual({ status: "found", name: "node", pid: 4242 });
  });

  it("marks a check skipped when its tool is missing, and still runs the other", async () => {
    const [report] = await diagnoseServices(services, [down("api", 3000)], {
      run: fakeRun({ "docker ps": done("") }),
      connect: async () => true,
      executable: noExecutable,
      platform: platformFor("darwin"),
    });
    expect(report?.checks).toEqual({
      port: { status: "listening" },
      process: { status: "skipped", reason: "lsof not found" },
      docker: { status: "none" },
    });
    const lines = formatDiagnosis(report as never, plain).join("\n");
    expect(lines).toContain("owner skipped: lsof not found");
  });

  it("says the owner is hidden when the port answers and lsof shows nobody", async () => {
    const [report] = await diagnoseServices(services, [down("api", 3000)], {
      run: fakeRun({ lsof: done("", 1) }),
      connect: async () => true,
      executable: noExecutable,
      platform: platformFor("linux"),
    });
    expect(report?.checks?.process).toEqual({ status: "hidden" });
    expect(report?.checks?.docker).toEqual({ status: "skipped", reason: "docker not found" });
  });

  it("runs nothing on this machine for a remote host or when all is up", async () => {
    const run = fakeRun({});
    const remote = config({ api: { url: "https://api.example.com/health" } });
    const result = { ...down("api", 443), target: "https://api.example.com/health" };
    const [report] = await diagnoseServices(remote, [result], {
      run,
      connect: async () => {
        throw new Error("no connection expected");
      },
      executable: noExecutable,
      platform: platformFor("linux"),
    });
    expect(report?.checks?.port).toEqual({ status: "skipped", reason: "remote host" });
    expect(formatDiagnosis(report as never, plain)).toHaveLength(1);
    await diagnoseServices(services, [up], {
      run,
      connect: async () => true,
      executable: noExecutable,
      platform: platformFor("linux"),
    });
    expect(run.calls).toEqual([]);
  });
});

describe("on this machine", () => {
  it("finds this very process on a port it listens on, with the real lsof", async ({ skip }) => {
    const server = createServer().listen(0, "127.0.0.1");
    onTestFinished(() => void server.close());
    await new Promise((ready) => server.once("listening", ready));
    const { port } = server.address() as AddressInfo;

    expect(await tcpConnect("127.0.0.1", port)).toBe(true);
    const lookup = await listenerOwners(runCommand, currentPlatform);
    if (lookup.state === "skipped") return skip(lookup.reason);
    expect(lookup.owners.get(port)?.pid).toBe(process.pid);
  });

  it("reports a missing command instead of throwing", async () => {
    expect(await runCommand("probe-no-such-command", [])).toEqual({ state: "missing" });
  });

  it("sees a closed port as closed", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise((ready) => server.once("listening", ready));
    const { port } = server.address() as AddressInfo;
    await new Promise((closed) => server.close(closed));
    expect(await tcpConnect("127.0.0.1", port)).toBe(false);
  });
});
