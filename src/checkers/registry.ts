import type { Service } from "../config/schema";
import { DEFAULT_CHECKER_TYPE } from "../constants";
import { ProbeError } from "../errors";
import { httpChecker } from "./http";
import type { ServiceType, ServiceTypes } from "./types";

const types = new Map<string, ServiceType>([httpChecker].map((type) => [type.type, type]));

export function getServiceType(type: string): ServiceType {
  const found = types.get(type);
  if (!found) {
    const known = [...types.keys()].join(", ");
    throw new ProbeError("CHECKER_UNKNOWN", `unknown service type "${type}". Known: ${known}.`);
  }
  return found;
}

// Schema v1 has no `type` field; a later schema adds it.
export const typeName = (service: Service): string =>
  (service as { type?: string }).type ?? DEFAULT_CHECKER_TYPE;

export const serviceType: ServiceTypes = (service) => getServiceType(typeName(service));

export const targetOf = (service: Service): string => serviceType(service).target(service);
