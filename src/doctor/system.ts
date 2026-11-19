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
    const options = { timeout: DOCTOR_COMMAND_TIMEOUT_MS, windowsHide: true };
    execFile(command, args, options, (error, stdout) => {
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

const NETSTAT_ARGS = ["-ano"];
const TASKLIST_ARGS = ["/FO", "CSV", "/NH"];
const NETSTAT_TCP_COLUMNS = 5;
const NO_PROCESS_NAME = "unknown process";

/**
 * Reads `netstat -ano`. The state word is translated on some Windows languages, so a listener is
 * told by its remote port, which is 0 for a socket that waits: TCP rows are `proto local remote state pid`.
 */
export function parseNetstat(output: string): Map<number, number> {
  const listeners = new Map<number, number>();
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length !== NETSTAT_TCP_COLUMNS || columns[0]?.toUpperCase() !== "TCP") continue;
    const port = portOf(columns[1] ?? "");
    const pid = Number(columns[4]);
    if (portOf(columns[2] ?? "") !== undefined || !Number.isInteger(pid)) continue;
    if (port !== undefined && !listeners.has(port)) listeners.set(port, pid);
  }
  return listeners;
}

/** Reads `tasklist /FO CSV /NH`: only the image name and the pid, the first two fields, are kept. */
export function parseTasklist(output: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of output.split("\n")) {
    const found = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (found) names.set(Number(found[2]), (found[1] as string).replace(/\.exe$/i, ""));
  }
  return names;
}

async function windowsOwners(run: RunCommand): Promise<OwnerLookup> {
  const netstat = await run("netstat", NETSTAT_ARGS);
  if (netstat.state !== "done" || netstat.code !== 0)
    return { state: "skipped", reason: "netstat did not answer" };
  const listeners = parseNetstat(netstat.stdout);
  const owners = new Map<number, ProcessInfo>();
  if (listeners.size === 0) return { state: "done", owners };
  const tasklist = await run("tasklist", TASKLIST_ARGS);
  const names = tasklist.state === "done" ? parseTasklist(tasklist.stdout) : new Map();
  for (const [port, pid] of listeners)
    owners.set(port, { name: names.get(pid) ?? NO_PROCESS_NAME, pid });
  return { state: "done", owners };
}

export type OwnerLookup =
  | { state: "done"; owners: Map<number, ProcessInfo> }
  | { state: "skipped"; reason: string };

// `+c 0` keeps the whole command name, `-nP` keeps lsof from resolving hosts and port names.
const LSOF_ARGS = ["-nP", "+c", "0", "-iTCP", "-sTCP:LISTEN", "-Fpcn"];
const SS_ARGS = ["-H", "-ltnp"];

export async function listenerOwners(run: RunCommand, platform: Platform): Promise<OwnerLookup> {
  if (platform.hasNetstat) return windowsOwners(run);
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
