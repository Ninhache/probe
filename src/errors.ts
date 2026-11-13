import { EXIT_ERROR } from "./constants";

export type ProbeErrorCode =
  | "NO_PROBE_DIR"
  | "ALREADY_INITIALIZED"
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "CONFIG_TOO_NEW"
  | "MIGRATION_MISSING"
  | "MAKEFILE_BLOCK_CORRUPT"
  | "SERVICE_EXISTS"
  | "SERVICE_UNKNOWN"
  | "CHECKER_UNKNOWN"
  | "USAGE";

export class ProbeError extends Error {
  readonly exitCode = EXIT_ERROR;

  constructor(
    readonly code: ProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProbeError";
  }
}
