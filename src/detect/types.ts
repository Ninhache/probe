import type { RawConfig } from "../config/migrations";

export interface Candidate {
  name: string;
  service: RawConfig;
  /** Where it was found, e.g. `.env (API_URL)`. Never holds a value read from a file. */
  source: string;
}

export interface Machine {
  ports: readonly number[];
  answers: (port: number) => Promise<boolean>;
}

export interface SourceContext extends Machine {
  read: (file: string) => Promise<string | null>;
  isKnown: (service: RawConfig) => boolean;
}

export interface Source {
  id: string;
  find: (context: SourceContext) => Promise<Candidate[]>;
}
