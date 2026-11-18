import { targetOf } from "../../checkers/registry";
import { serviceSchemaV1 } from "../../config/schema";
import { DETECT_PORTS, DETECT_PORTS_ENV, DETECT_TIMEOUT_MS } from "../../constants";
import { DEFAULT_HOST } from "../shared";
import type { Candidate, Source } from "../types";

export function detectPorts(env: NodeJS.ProcessEnv): number[] {
  const listed = env[DETECT_PORTS_ENV];
  if (listed === undefined) return [...DETECT_PORTS];
  return listed
    .split(",")
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

// The first response is the answer: following a redirect could send a request outside the machine.
export async function answersHttp(port: number, timeoutMs = DETECT_TIMEOUT_MS): Promise<boolean> {
  const url = targetOf(serviceSchemaV1.parse({ port }));
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export const portsSource: Source = {
  id: "ports",
  async find({ ports, answers, isKnown }) {
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
