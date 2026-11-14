import type { RawConfig } from "../config/migrations";

/** A service found in the project, not declared yet. */
export interface Candidate {
  name: string;
  /** The entry as it would be written to `config.yml`: defaults left out. */
  service: RawConfig;
  /** Where it was found, e.g. `.env (API_URL)`. Never holds a value read from a file. */
  source: string;
}

/** What the machine lends to the sources. Tests pass their own. */
export interface Machine {
  /** Local ports worth trying. */
  ports: readonly number[];
  /** Tells whether an HTTP server answers on that local port. */
  answers: (port: number) => Promise<boolean>;
}

/** What a source may use to look at the project. */
export interface SourceContext extends Machine {
  /** Returns the text of a file of the project, by its path from the project root; null when unreadable. */
  read: (file: string) => Promise<string | null>;
  /** Tells whether the config or an earlier source already has a service at that host and port. */
  isKnown: (service: RawConfig) => boolean;
}

/**
 * One place where services can be found: a file format, a tool, the machine.
 * A source only reports what it sees. Whether a candidate is valid, reachable by a check,
 * already declared or in need of another name is decided once, by `detectServices`.
 */
export interface Source {
  /** Short name, for tests and messages: `compose`, `env`… */
  id: string;
  find: (context: SourceContext) => Promise<Candidate[]>;
}
