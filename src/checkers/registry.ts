import { DATABASE_TYPES, type Service } from "../config/schema";
import { DEFAULT_CHECKER_TYPE } from "../constants";
import { ProbeError } from "../errors";
import { commandChecker } from "./command";
import { databaseType } from "./database";
import { httpChecker } from "./http";
import type { CheckResult, ParameterKind, ServiceType, ServiceTypes } from "./types";

const types = new Map<string, ServiceType>(
  [httpChecker, commandChecker, ...DATABASE_TYPES.map(databaseType)].map((type) => [
    type.type,
    type,
  ]),
);

/** Every way of sending a parameter that one type at least understands. */
export const PARAMETER_KINDS: readonly ParameterKind[] = [
  ...new Set([...types.values()].flatMap(({ parameterKinds = [] }) => parameterKinds)),
];

export function getServiceType(type: string): ServiceType {
  const found = types.get(type);
  if (!found) {
    const known = [...types.keys()].join(", ");
    throw new ProbeError("CHECKER_UNKNOWN", `unknown service type "${type}". Known: ${known}.`);
  }
  return found;
}

export const typeName = (service: Service): string => service.type ?? DEFAULT_CHECKER_TYPE;

export const serviceType: ServiceTypes = (service) => getServiceType(typeName(service));

/** The names of every registered type, the default one first: what the add form offers. */
export const serviceTypeNames = (): readonly string[] => [
  DEFAULT_CHECKER_TYPE,
  ...[...types.keys()].filter((name) => name !== DEFAULT_CHECKER_TYPE),
];

/** The type `a` adds: the config has no key to name another one. */
export const defaultType = (): ServiceType => getServiceType(DEFAULT_CHECKER_TYPE);

export const targetOf = (service: Service): string => serviceType(service).target(service);

/** What an up service answered, said by its type: `up` for a type that says nothing, or one not registered. */
export const answer = (result: CheckResult): string =>
  types.get(result.type)?.answer?.(result) ?? "up";

/** Whether the services of a type keep the response they got. */
export const keepsResponse = (type: string): boolean => types.get(type)?.response === true;
