import type { ServiceFields } from "../commands/service-writes";
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

/** What an up service answered: its status, or `up` for a type that has none. */
export const answer = ({ status }: CheckResult): string =>
  status === undefined ? "up" : String(status);

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
  form: ServiceForm;
}

export interface FormField {
  key: string;
  label: string;
  placeholder: string;
}

export type FieldValues = Readonly<Record<string, string>>;

/** The fields the dashboard asks for a service of a type, after its name. */
export interface ServiceForm {
  fields: readonly FormField[];
  /** One line per header, `Name: value`, a secret kept in local.yml. */
  headers?: boolean;
  /** What an address of the `url` parameter replaces: its lines come before the first of them. */
  replacedByUrl?: ReadonlySet<string>;
  read(fields: ServiceFields): FieldValues;
  /** What the config would refuse in a field, said without the value. */
  problem(key: string, value: string): string | undefined;
  written(values: FieldValues): Omit<ServiceFields, "headers">;
}

/** The type of each service: the registry by default, another one in tests. */
export type ServiceTypes = (service: Service) => ServiceType;
