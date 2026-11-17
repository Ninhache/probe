import type { Variables } from "../config/local";
import type { Service } from "../config/schema";
import type { ResponseDetail } from "./response";

export interface CheckContext {
  timeoutMs: number;
  signal?: AbortSignal;
  detail?: boolean;
  variables?: Variables;
}

export interface CheckResult {
  name: string;
  type: string;
  /** Also true for a skipped service: it is not down. */
  ok: boolean;
  skipped?: true;
  target: string;
  status?: number;
  latencyMs: number;
  error?: string;
  hint?: string;
  /** Only when the check was asked for the detail: never in what `check --json` prints. */
  response?: ResponseDetail;
  /** The method the request uses; only for the detail. */
  method?: string;
  /** The headers as `.probe/config.yml` writes them, secrets hidden; only for the detail too. */
  sent?: string[];
}

export interface Checker {
  type: string;
  check(name: string, service: Service, context: CheckContext): Promise<CheckResult>;
}

export interface CopiedCommand {
  command: string;
  /** What the command needs from the shell that runs it. */
  note?: string;
}

/** A kind of service: how it is checked, and what the lists, `u` and `c` make of it. */
export interface ServiceType extends Checker {
  /** The address lists and reports show. */
  target(service: Service): string;
  /** What `u` and `probe open` open: a type without one has nothing to open. */
  open?(service: Service): string;
  /** What `c` and `probe curl` give: a type without one has no command. */
  copy?(service: Service, env: NodeJS.ProcessEnv): CopiedCommand;
}

/** The type of each service: the registry by default, another one in tests. */
export type ServiceTypes = (service: Service) => ServiceType;
