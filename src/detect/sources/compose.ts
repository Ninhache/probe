import { parse } from "yaml";
import { isHttpPort, parseEnvFile, serviceName } from "../shared";
import type { Candidate, Source } from "../types";

// The names `docker compose` looks for, in its order of preference: it reads the first one
// there is, then the first override, which is where the ports of a dev setup often are.
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
const OVERRIDE_FILES = [
  "compose.override.yaml",
  "compose.override.yml",
  "docker-compose.override.yaml",
  "docker-compose.override.yml",
];
// The one file compose takes its variables from.
const VARIABLES_FILE = ".env";
// ${VAR}, ${VAR:-default}, ${VAR-default} and $VAR.
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const PORT = /^\d+$/;

interface Published {
  /** Port opened on the machine. */
  host: number;
  /** Port inside the container: it tells what kind of server this is. */
  container: number;
}

type Variables = Map<string, string>;

const substituted = (text: string, variables: Variables) =>
  text.replace(VARIABLE, (_match, braced, operator, fallback, bare) => {
    const value = variables.get(braced ?? bare);
    // `:-` also replaces an empty value, `-` only a missing one.
    const missing = value === undefined || (operator === ":-" && value === "");
    return missing ? (fallback ?? "") : value;
  });

/** Reads one entry of `ports:`; null when it opens no fixed TCP port on the machine. */
function published(entry: unknown, variables: Variables): Published | null {
  let host: string;
  let container: string;
  if (typeof entry === "string") {
    const [mapping = "", protocol = "tcp"] = substituted(entry, variables).split("/");
    if (protocol !== "tcp") return null;
    // "8080:80" or "127.0.0.1:8080:80". "80" alone gets a random port: nothing to check.
    const parts = mapping.split(":");
    if (parts.length < 2) return null;
    [host = "", container = ""] = parts.slice(-2);
  } else if (entry && typeof entry === "object") {
    const long = entry as { published?: unknown; target?: unknown; protocol?: unknown };
    if ((long.protocol ?? "tcp") !== "tcp") return null;
    host = substituted(String(long.published ?? ""), variables);
    container = String(long.target ?? "");
  } else {
    return null;
  }
  if (!PORT.test(host) || !PORT.test(container)) return null;
  return { host: Number(host), container: Number(container) };
}

function inFile(file: string, text: string, variables: Variables): Candidate[] {
  let document: { services?: unknown };
  try {
    document = parse(text, { merge: true }) ?? {};
  } catch {
    return [];
  }
  if (!document.services || typeof document.services !== "object") return [];
  const found: Candidate[] = [];
  for (const [name, definition] of Object.entries(document.services)) {
    const ports = (definition as { ports?: unknown } | null)?.ports;
    if (!Array.isArray(ports)) continue;
    const reachable = ports
      .map((entry) => published(entry, variables))
      .filter((port) => port !== null)
      .filter((port) => isHttpPort(port.host) && isHttpPort(port.container));
    reachable.forEach(({ host }, index) => {
      found.push({
        // A service that publishes several ports: the first keeps its name.
        name: serviceName(index === 0 ? name : `${name}-${host}`),
        service: { port: host },
        source: `${file} (${name} service)`,
      });
    });
  }
  return found;
}

/**
 * The ports the services of a compose file publish on the machine.
 * Variables in a port (`"${WEB_PORT:-8080}:80"`) take their value from `.env`; those of the shell
 * are not looked at.
 */
export const composeSource: Source = {
  id: "compose",
  async find({ read }) {
    const variables: Variables = new Map(parseEnvFile((await read(VARIABLES_FILE)) ?? ""));
    const found: Candidate[] = [];
    for (const names of [COMPOSE_FILES, OVERRIDE_FILES]) {
      for (const file of names) {
        const text = await read(file);
        if (text === null) continue;
        found.push(...inFile(file, text, variables));
        break;
      }
    }
    return found;
  },
};
