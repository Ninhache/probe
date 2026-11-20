import { defineCommand } from "citty";
import {
  envNameProblem,
  envValueProblem,
  headerNameProblem,
  headerValueProblem,
  isSensitiveEnv,
  isSensitiveHeader,
  parseEnvLine,
  parseHeaderLine,
  reference,
  serviceVariables,
} from "../config/headers";
import { loadVariables } from "../config/local";
import type { RawConfig } from "../config/migrations";
import { DEFAULT_METHOD, METHODS, type Method, urlProblem } from "../config/schema";
import {
  commandValueProblem,
  containsProblem,
  expectProblem,
  hintProblem,
  methodProblem,
  nameProblem,
  pathProblem,
  portProblem,
} from "../config/service-input";
import { DEFAULT_TIMEOUT_SECONDS } from "../constants";
import { ProbeError } from "../errors";
import { ask } from "../ui/prompt";
import { offerDetected } from "./detected";
import { openProject, rawServices, saveServices, secondsToMs, tagsFrom } from "./shared";

function parseInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ProbeError("USAGE", `${flag} expects a number, got "${value}".`);
  }
  return Number(value);
}

function parseExpect(value: string): number | number[] {
  const codes = value.split(",").map((code) => parseInteger(code.trim(), "--expect"));
  return codes.length === 1 ? (codes[0] as number) : codes;
}

const DEFAULT_PATH = "/";
const ADDRESS_FLAGS = ["port", "host", "path"] as const;

function addressFrom(args: {
  url?: string;
  port?: string;
  host?: string;
  path?: string;
}): RawConfig {
  if (args.url !== undefined) {
    const extra = ADDRESS_FLAGS.filter((flag) => args[flag] !== undefined);
    if (extra.length > 0) {
      const flags = extra.map((flag) => `--${flag}`).join(", ");
      throw new ProbeError("USAGE", `--url already says where the service is: remove ${flags}.`);
    }
    const problem = urlProblem(String(args.url));
    if (problem) throw new ProbeError("USAGE", `--url expects ${problem}.`);
    return { url: String(args.url) };
  }
  if (args.port === undefined) {
    throw new ProbeError(
      "USAGE",
      "say where the service is: --port 3000, or --url https://localhost:8443/health.",
    );
  }
  const service: RawConfig = { port: parseInteger(String(args.port), "--port") };
  if (args.host) service.host = args.host;
  if (args.path) service.path = args.path;
  return service;
}

// What a service that runs a command cannot say: each of these describes a request.
const HTTP_FLAGS = [
  "url",
  "port",
  "host",
  "path",
  "expect",
  "contains",
  "method",
  "header",
] as const;

/** What follows the first `--`: a command as a list, spawned without a shell. */
const afterDashes = (rawArgs: string[]): string[] => {
  const at = rawArgs.indexOf("--");
  return at === -1 ? [] : rawArgs.slice(at + 1);
};

type AddArgs = Partial<Record<(typeof HTTP_FLAGS)[number] | "command", unknown>>;

function commandService(args: AddArgs, rawArgs: string[]): RawConfig | undefined {
  const list = afterDashes(rawArgs);
  if (args.command === undefined && list.length === 0) return undefined;
  if (args.command !== undefined && list.length > 0) {
    throw new ProbeError("USAGE", "give the command once: --command '<string>', or after --.");
  }
  const clash = HTTP_FLAGS.filter((flag) => args[flag] !== undefined);
  if (clash.length > 0) {
    const flags = clash.map((flag) => `--${flag}`).join(", ");
    throw new ProbeError(
      "USAGE",
      `--command runs a command, it sends no request: remove ${flags}.`,
    );
  }
  const command = args.command === undefined ? list : String(args.command);
  const problem = commandValueProblem(command);
  if (problem) throw new ProbeError("USAGE", `--command ${problem}.`);
  return { type: "command", command };
}

const LONG_HEADER = "--header";
const SHORT_HEADER = "-H";
const HEADER_FLAGS = [LONG_HEADER, SHORT_HEADER];
const HEADER_EXAMPLE = "--header 'Accept: application/json'";

/** Every `--header` of the command line: the argument parser keeps the last one only. */
function headerLines(rawArgs: string[]): string[] {
  const lines: string[] = [];
  for (const [index, arg] of rawArgs.entries()) {
    if (arg === "--") break;
    if (HEADER_FLAGS.includes(arg)) lines.push(rawArgs[index + 1] ?? "");
    else if (arg.startsWith(`${LONG_HEADER}=`)) lines.push(arg.slice(LONG_HEADER.length + 1));
    else if (arg.startsWith(SHORT_HEADER) && !arg.startsWith("--")) {
      lines.push(arg.slice(SHORT_HEADER.length).replace(/^=/, ""));
    }
  }
  return lines;
}

const LONG_ENV = "--setenv";
const ENV_EXAMPLE = "--setenv MYSQL_HOST=127.0.0.1";

/** Every `--setenv` of the command line: the argument parser keeps the last one only. */
function envLines(rawArgs: string[]): string[] {
  const lines: string[] = [];
  for (const [index, arg] of rawArgs.entries()) {
    if (arg === "--") break;
    if (arg === LONG_ENV) lines.push(rawArgs[index + 1] ?? "");
    else if (arg.startsWith(`${LONG_ENV}=`)) lines.push(arg.slice(LONG_ENV.length + 1));
  }
  return lines;
}

// Said without the value, like the headers: a secret typed there must not come back on screen.
function envFrom(lines: string[]): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) throw new ProbeError("USAGE", `--setenv expects NAME=value, e.g. ${ENV_EXAMPLE}.`);
    const [name, value] = parsed;
    const nameProblem = envNameProblem(name);
    if (nameProblem) throw new ProbeError("USAGE", `--setenv expects ${nameProblem}.`);
    if (Object.hasOwn(env, name)) throw new ProbeError("USAGE", `--setenv gives ${name} twice.`);
    const problem = envValueProblem(name, value);
    if (problem) {
      // Between double quotes the shell fills the variable in before probe sees it.
      const quotes = isSensitiveEnv(name) ? " Keep the single quotes around the value." : "";
      throw new ProbeError("USAGE", `--setenv ${name} expects ${problem}.${quotes}`);
    }
    env[name] = value;
  }
  return lines.length > 0 ? env : undefined;
}

// What is refused is said without the value: a secret typed there must not come back on screen.
function headersFrom(lines: string[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const line of lines) {
    const parsed = parseHeaderLine(line);
    if (!parsed) {
      throw new ProbeError("USAGE", `--header expects "Name: value", e.g. ${HEADER_EXAMPLE}.`);
    }
    const [name, value] = parsed;
    const nameProblem = headerNameProblem(name);
    if (nameProblem) throw new ProbeError("USAGE", `--header expects ${nameProblem}.`);
    if (seen.has(name.toLowerCase())) {
      throw new ProbeError("USAGE", `--header gives ${name} twice.`);
    }
    seen.add(name.toLowerCase());
    const problem = headerValueProblem(name, value);
    if (problem) {
      // Between double quotes the shell fills the variable in before probe sees it.
      const quotes = isSensitiveHeader(name) ? " Keep the single quotes around the header." : "";
      throw new ProbeError("USAGE", `--header ${name} expects ${problem}.${quotes}`);
    }
    headers[name] = value;
  }
  return lines.length > 0 ? headers : undefined;
}

export async function guidedAdd(): Promise<void> {
  const loaded = await openProject();
  const services = rawServices(loaded);
  const detected = await offerDetected(loaded);
  if (detected === null) {
    console.log("Nothing added.");
    return;
  }
  if (detected.length > 0) return;
  const answers: string[] = [];
  const questions = [
    {
      message: "Service name",
      placeholder: "api",
      validate: (v: string) => nameProblem(v, Object.keys(services)),
    },
    { message: "Port", placeholder: "3000", validate: portProblem },
    {
      message: "Path to request",
      placeholder: DEFAULT_PATH,
      defaultValue: DEFAULT_PATH,
      validate: pathProblem,
    },
    {
      message: "Expected status",
      placeholder: "any 2xx",
      defaultValue: "",
      validate: expectProblem,
    },
  ];
  for (const { message, ...question } of questions) {
    const answer = await ask(message, question);
    if (answer === null) {
      console.log("Nothing added.");
      return;
    }
    answers.push(answer);
  }
  const [name, port, path, expect] = answers as [string, string, string, string];
  const service: RawConfig = { port: Number(port) };
  if (path !== DEFAULT_PATH) service.path = path;
  if (expect) service.expect = parseExpect(expect);

  await saveServices(loaded, { ...services, [name]: service });
  console.log(`Added ${name}. Try: probe check ${name}`);
}

export default defineCommand({
  meta: { name: "add", description: "Add a service" },
  args: {
    name: { type: "positional", description: "Service name", required: true },
    command: {
      type: "string",
      valueHint: "string",
      description:
        'Check by running a command: up when it exits 0, e.g. --command "redis-cli ping". Without a shell: probe add db -- pg_isready -q',
    },
    port: { type: "string", alias: "p", description: "Port" },
    host: { type: "string", description: "Host (default: localhost)" },
    path: { type: "string", description: "Path to request (default: /)" },
    url: {
      type: "string",
      description: "Full URL, http or https, instead of --port, --host and --path",
    },
    expect: { type: "string", description: "Expected status, e.g. 200 or 200,204 (default: 2xx)" },
    contains: {
      type: "string",
      valueHint: "text",
      description: `Text the response body must contain, e.g. --contains '"status":"ok"'`,
    },
    timeout: {
      type: "string",
      description: `Seconds to wait for this service (default: ${DEFAULT_TIMEOUT_SECONDS})`,
    },
    method: {
      type: "string",
      alias: "X",
      description: "Method of the request, sent without a body, e.g. POST (default: GET)",
    },
    setenv: {
      type: "string",
      valueHint: "NAME=value",
      description: `Variable for the command, repeatable; a secret as a reference: 'DB_PWD=${reference("DB_PASSWORD")}'`,
    },
    header: {
      type: "string",
      alias: "H",
      valueHint: "Name: value",
      description: `Header to send, repeatable; a secret as a reference: 'X-Api-Key: ${reference("API_KEY")}'`,
    },
    hint: {
      type: "string",
      valueHint: "text",
      description: "What to do when it is down, shown under it, e.g. 'run: make api'",
    },
    tag: {
      type: "string",
      valueHint: "a,b",
      description: "Tags to select it with, e.g. --tag back,infra then: probe check --tag back",
    },
  },
  async run({ args, rawArgs }) {
    const loaded = await openProject();
    const services = rawServices(loaded);
    if (Object.hasOwn(services, args.name)) {
      throw new ProbeError(
        "SERVICE_EXISTS",
        `service "${args.name}" already exists. Remove it first: probe rm ${args.name}`,
      );
    }
    // The command flags are checked first: a request option beside them is refused there.
    const service = commandService(args, rawArgs) ?? addressFrom(args);
    if (args.expect) service.expect = parseExpect(String(args.expect));
    if (args.contains !== undefined) {
      const problem = containsProblem(String(args.contains));
      if (problem) throw new ProbeError("USAGE", `--contains expects ${problem}.`);
      service.contains = String(args.contains);
    }
    if (args.timeout !== undefined) {
      secondsToMs("--timeout", String(args.timeout));
      service.timeout = Number(args.timeout);
    }
    if (args.method !== undefined) {
      if (methodProblem(String(args.method))) {
        throw new ProbeError("USAGE", `--method expects one of ${METHODS.join(", ")}.`);
      }
      const method = String(args.method).toUpperCase() as Method;
      if (method !== DEFAULT_METHOD) service.method = method;
    }
    if (service.method === "HEAD" && service.contains !== undefined) {
      throw new ProbeError(
        "USAGE",
        "--contains cannot go with --method HEAD, whose response has no body.",
      );
    }
    const headers = headersFrom(headerLines(rawArgs));
    // Never a service saved without a header that was asked for.
    if (args.header !== undefined && !headers) {
      throw new ProbeError("USAGE", `--header expects "Name: value", e.g. ${HEADER_EXAMPLE}.`);
    }
    if (headers) service.headers = headers;
    const env = envFrom(envLines(rawArgs));
    if (env && service.type !== "command") {
      throw new ProbeError("USAGE", "--setenv sets the environment of a command: add --command.");
    }
    if (env) service.env = env;
    if (args.hint !== undefined) {
      const hint = String(args.hint);
      if (hintProblem(hint)) throw new ProbeError("USAGE", `--hint expects ${hintProblem(hint)}.`);
      service.hint = hint;
    }
    const tags = tagsFrom(rawArgs);
    if (tags.length > 0) service.tags = tags;

    await saveServices(loaded, { ...services, [args.name]: service });
    const { lookup } = await loadVariables(loaded.paths);
    const [unset] = serviceVariables({ headers, env }).filter((name) => !lookup(name));
    console.log(
      unset === undefined
        ? `Added ${args.name}. Try: probe check ${args.name}`
        : `Added ${args.name}. It ${service.type === "command" ? "needs" : "sends"} ${unset}, not set yet: probe var ${unset}`,
    );
  },
});
