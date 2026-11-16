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
  | "VARIABLE_UNSET"
  | "ENVIRONMENT_UNKNOWN"
  | "USAGE";

export class ProbeError extends Error {
  readonly exitCode = EXIT_ERROR;

  constructor(
    readonly code: ProbeErrorCode,
    message: string,
    /** Absolute path of the file the message names, to link it on a terminal that can. */
    readonly file?: string,
  ) {
    super(message);
    this.name = "ProbeError";
  }
}
