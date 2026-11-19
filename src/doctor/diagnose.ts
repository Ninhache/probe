import { serviceType, targetOf } from "../checkers/registry";
import type { CheckResult } from "../checkers/types";
import type { Config } from "../config/schema";
import type { Platform } from "../platform";
import {
  type Connect,
  type ContainerLookup,
  type ExecutableName,
  listenerOwners,
  type OwnerLookup,
  publishingContainers,
  type RunCommand,
} from "./system";

export interface PortCheck {
  status: "listening" | "closed" | "skipped";
  reason?: string;
}

export interface ProcessCheck {
  status: "found" | "hidden" | "none" | "skipped";
  name?: string;
  pid?: number;
  reason?: string;
}

export interface DockerCheck {
  status: "running" | "stopped" | "none" | "skipped";
  containers?: { name: string; state: string }[];
  reason?: string;
}

export interface ServiceChecks {
  port: PortCheck;
  process: ProcessCheck;
  docker: DockerCheck;
}

export interface ServiceReport extends CheckResult {
  port?: number;
  checks?: ServiceChecks;
}

export interface DiagnoseDeps {
  run: RunCommand;
  connect: Connect;
  executable: ExecutableName;
  platform: Platform;
}

const REMOTE = "remote host";
const RUNNING = "running";
const DEFAULT_PORTS: Record<string, number> = { "http:": 80, "https:": 443 };

interface Endpoint {
  host: string;
  port: number;
  local: boolean;
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

export function endpointOf(target: string): Endpoint | undefined {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol];
  if (port === undefined) return undefined;
  return { host, port, local: isLocalHost(host) };
}

function processCheck(listening: boolean, port: number, owners: OwnerLookup | null): ProcessCheck {
  if (!listening || !owners) return { status: "none" };
  if (owners.state === "skipped") return { status: "skipped", reason: owners.reason };
  const owner = owners.owners.get(port);
  return owner ? { status: "found", ...owner } : { status: "hidden" };
}

function dockerCheck(port: number, lookup: ContainerLookup): DockerCheck {
  if (lookup.state === "skipped") return { status: "skipped", reason: lookup.reason };
  const containers = lookup.containers
    .filter((container) => container.ports.includes(port))
    .map(({ name, state }) => ({ name, state }));
  if (containers.length === 0) return { status: "none" };
  const running = containers.some(({ state }) => state === RUNNING);
  return { status: running ? "running" : "stopped", containers };
}

/** Looks at this machine for every service that is down: an up or skipped one is left as it is. */
export async function diagnoseServices(
  config: Config,
  results: readonly CheckResult[],
  { run, connect, executable, platform }: DiagnoseDeps,
): Promise<ServiceReport[]> {
  const down = new Map<string, Endpoint | undefined>();
  for (const result of results) {
    const service = config.services[result.name];
    // A type with no address has no port to look at: its own reason says all there is.
    if (!result.ok && service && serviceType(service).open)
      down.set(result.name, endpointOf(targetOf(service)));
  }
  const local = [...down.values()].filter((endpoint) => endpoint?.local) as Endpoint[];
  const open = new Map<Endpoint, boolean>(
    await Promise.all(
      local.map(
        async (endpoint) => [endpoint, await connect(endpoint.host, endpoint.port)] as const,
      ),
    ),
  );
  const [owners, containers] = await Promise.all([
    [...open.values()].some(Boolean) ? listenerOwners(run, platform) : null,
    local.length > 0 ? publishingContainers(run) : null,
  ]);

  const reports = results.map((result): ServiceReport => {
    if (!down.has(result.name)) return result;
    const endpoint = down.get(result.name);
    if (!endpoint?.local || !containers) {
      const skipped = { status: "skipped" as const, reason: REMOTE };
      return {
        ...result,
        ...(endpoint ? { port: endpoint.port } : {}),
        checks: { port: skipped, process: skipped, docker: skipped },
      };
    }
    const listening = open.get(endpoint) === true;
    return {
      ...result,
      port: endpoint.port,
      checks: {
        port: { status: listening ? "listening" : "closed" },
        process: processCheck(listening, endpoint.port, owners),
        docker: dockerCheck(endpoint.port, containers),
      },
    };
  });
  for (const { checks } of reports) {
    const found = checks?.process;
    if (found?.status === "found" && found.pid !== undefined) {
      found.name = (await executable(found.pid)) ?? found.name;
    }
  }
  return reports;
}
