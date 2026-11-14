import { targetUrl } from "../../checkers/http";
import { serviceSchemaV1 } from "../../config/schema";
import { DETECT_PORTS, DETECT_PORTS_ENV, DETECT_TIMEOUT_MS } from "../../constants";
import { DEFAULT_HOST } from "../shared";
import type { Candidate, Source } from "../types";

export interface PortProbe {
  /** Local ports to try. */
  ports: readonly number[];
  /** Tells whether an HTTP server answers on that local port. */
  answers: (port: number) => Promise<boolean>;
}

/** Ports to try: `PROBE_DETECT_PORTS` (comma-separated, empty for none) when set, else the usual ones. */
export function detectPorts(env: NodeJS.ProcessEnv): number[] {
  const listed = env[DETECT_PORTS_ENV];
  if (listed === undefined) return [...DETECT_PORTS];
  return listed
    .split(",")
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

/**
 * One GET with a short time limit. The first response is the answer: following a redirect
 * would send a request somewhere else, possibly outside the machine.
 */
export async function answersHttp(port: number): Promise<boolean> {
  const url = targetUrl(serviceSchemaV1.parse({ port }));
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      redirect: "manual",
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** The local ports where an HTTP server answers right now, among those no file already gave. */
export function portsSource({ ports, answers }: PortProbe): Source {
  return {
    id: "ports",
    async find({ isKnown }) {
      const tried = ports.filter((port) => !isKnown({ port }));
      const open = await Promise.all(
        tried.map(async (port) => ((await answers(port)) ? port : null)),
      );
      return open
        .filter((port) => port !== null)
        .map(
          (port): Candidate => ({
            name: `port-${port}`,
            service: { port },
            source: `answers on ${DEFAULT_HOST}:${port}`,
          }),
        );
    },
  };
}
