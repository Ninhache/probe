import { execFile } from "node:child_process";
import { connect as netConnect } from "node:net";
import { DOCTOR_COMMAND_TIMEOUT_MS, DOCTOR_CONNECT_TIMEOUT_MS } from "../constants";
import { currentPlatform, type Platform } from "../platform";

export type CommandResult =
  | { state: "missing" }
  | { state: "failed" }
  | { state: "done"; code: number; stdout: string };

export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

export const runCommand: RunCommand = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: DOCTOR_COMMAND_TIMEOUT_MS }, (error, stdout) => {
      if (!error) return resolve({ state: "done", code: 0, stdout });
      const { code } = error as { code?: unknown };
      if (code === "ENOENT") return resolve({ state: "missing" });
      if (typeof code !== "number") return resolve({ state: "failed" });
      resolve({ state: "done", code, stdout });
    });
  });

export type Connect = (host: string, port: number) => Promise<boolean>;

export const tcpConnect: Connect = (host, port) =>
  new Promise((resolve) => {
    const socket = netConnect({ host, port });
    const settle = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(DOCTOR_CONNECT_TIMEOUT_MS, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });

export interface ProcessInfo {
  name: string;
  pid: number;
}

export type ExecutableName = (pid: number) => Promise<string | undefined>;

export const executableName: ExecutableName = (pid) => currentPlatform.executableName(pid);

function portOf(address: string): number | undefined {
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

/** Reads `lsof -F pcn`: one `p` and one `c` line per process, then one `n` line per socket. */
export function parseLsof(output: string): Map<number, ProcessInfo> {
  const owners = new Map<number, ProcessInfo>();
  let pid: number | undefined;
  let name = "";
  for (const line of output.split("\n")) {
    const value = line.slice(1);
    if (line.startsWith("p")) pid = Number(value);
    else if (line.startsWith("c")) name = value;
    else if (line.startsWith("n") && pid !== undefined) {
      const port = portOf(value);
      if (port !== undefined && !owners.has(port)) owners.set(port, { name, pid });
    }
  }
  return owners;
}

const SS_LOCAL_COLUMN = 3;
const SS_PROCESS = /users:\(\("([^"]+)",pid=(\d+)/;

export function parseSs(output: string): Map<number, ProcessInfo> {
  const owners = new Map<number, ProcessInfo>();
  for (const line of output.split("\n")) {
    const port = portOf(line.trim().split(/\s+/)[SS_LOCAL_COLUMN] ?? "");
    const found = SS_PROCESS.exec(line);
    if (port === undefined || !found || owners.has(port)) continue;
    owners.set(port, { name: found[1] as string, pid: Number(found[2]) });
  }
  return owners;
}

export type OwnerLookup =
  | { state: "done"; owners: Map<number, ProcessInfo> }
  | { state: "skipped"; reason: string };

// `+c 0` keeps the whole command name, `-nP` keeps lsof from resolving hosts and port names.
const LSOF_ARGS = ["-nP", "+c", "0", "-iTCP", "-sTCP:LISTEN", "-Fpcn"];
const SS_ARGS = ["-H", "-ltnp"];

export async function listenerOwners(run: RunCommand, platform: Platform): Promise<OwnerLookup> {
  const lsof = await run("lsof", LSOF_ARGS);
  // lsof exits 1 when no socket matches: what it printed is read whatever the code.
  if (lsof.state === "done") return { state: "done", owners: parseLsof(lsof.stdout) };
  if (lsof.state === "failed") return { state: "skipped", reason: "lsof did not answer" };
  if (!platform.hasSs) return { state: "skipped", reason: "lsof not found" };
  const ss = await run("ss", SS_ARGS);
  if (ss.state === "done" && ss.code === 0) return { state: "done", owners: parseSs(ss.stdout) };
  return { state: "skipped", reason: "lsof not found" };
}

export interface PublishingContainer {
  name: string;
  state: string;
  ports: number[];
}

export type ContainerLookup =
  | { state: "done"; containers: PublishingContainer[] }
  | { state: "skipped"; reason: string };

// Nothing else of a container is asked for: its environment and its command can hold secrets.
const INSPECT_FORMAT = "{{.Name}}|{{.State.Status}}|{{json .HostConfig.PortBindings}}";
const TCP = "/tcp";

function publishedPorts(json: string): number[] {
  let bindings: unknown;
  try {
    bindings = JSON.parse(json);
  } catch {
    return [];
  }
  if (bindings === null || typeof bindings !== "object") return [];
  const ports = new Set<number>();
  for (const [key, hosts] of Object.entries(bindings)) {
    if (!key.endsWith(TCP) || !Array.isArray(hosts)) continue;
    for (const host of hosts) {
      const port = Number((host as { HostPort?: unknown } | null)?.HostPort);
      if (Number.isInteger(port) && port > 0) ports.add(port);
    }
  }
  return [...ports];
}

export function parseDockerInspect(output: string): PublishingContainer[] {
  const containers: PublishingContainer[] = [];
  for (const line of output.split("\n")) {
    const [name, state, ...rest] = line.split("|");
    if (!name || !state) continue;
    const ports = publishedPorts(rest.join("|"));
    if (ports.length > 0) containers.push({ name: name.replace(/^\//, ""), state, ports });
  }
  return containers;
}

const DOCKER_SILENT = "docker did not answer (daemon stopped, or no permission)";

// `docker ps` leaves the ports of a stopped container empty: only `inspect` still has them.
export async function publishingContainers(run: RunCommand): Promise<ContainerLookup> {
  const list = await run("docker", ["ps", "-aq"]);
  if (list.state === "missing") return { state: "skipped", reason: "docker not found" };
  if (list.state === "failed" || list.code !== 0)
    return { state: "skipped", reason: DOCKER_SILENT };
  const ids = list.stdout.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return { state: "done", containers: [] };
  const inspect = await run("docker", ["inspect", "--format", INSPECT_FORMAT, ...ids]);
  // A container removed between the two calls makes inspect exit 1 with the others printed.
  if (inspect.state !== "done") return { state: "skipped", reason: DOCKER_SILENT };
  return { state: "done", containers: parseDockerInspect(inspect.stdout) };
}
