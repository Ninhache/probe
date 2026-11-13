import { ProbeError } from "../errors";
import { httpChecker } from "./http";
import type { Checker } from "./types";

// A new service type = one checker file + one entry here.
const checkers = new Map<string, Checker>([httpChecker].map((checker) => [checker.type, checker]));

export function getChecker(type: string): Checker {
  const checker = checkers.get(type);
  if (!checker) {
    const known = [...checkers.keys()].join(", ");
    throw new ProbeError("CHECKER_UNKNOWN", `unknown service type "${type}". Known: ${known}.`);
  }
  return checker;
}
