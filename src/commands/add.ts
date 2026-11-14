import { defineCommand } from "citty";
import type { RawConfig } from "../config/migrations";
import { expectProblem, nameProblem, pathProblem, portProblem } from "../config/service-input";
import { DEFAULT_TIMEOUT_SECONDS } from "../constants";
import { ProbeError } from "../errors";
import { ask } from "../ui/prompt";
import { offerDetected } from "./detected";
import { openProject, rawServices, saveServices, secondsToMs } from "./shared";

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

/**
 * `probe add` alone on a terminal: proposes the services found in the project, and when none is
 * found or ticked, asks for the name, port, path and expected status, then adds the service.
 * Each answer is asked again until the config schema accepts it. Cancelling writes nothing.
 */
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
    port: { type: "string", alias: "p", description: "Port", required: true },
    host: { type: "string", description: "Host (default: localhost)" },
    path: { type: "string", description: "Path to request (default: /)" },
    expect: { type: "string", description: "Expected status, e.g. 200 or 200,204 (default: 2xx)" },
    timeout: {
      type: "string",
      description: `Seconds to wait for this service (default: ${DEFAULT_TIMEOUT_SECONDS})`,
    },
  },
  async run({ args }) {
    const loaded = await openProject();
    const services = rawServices(loaded);
    if (Object.hasOwn(services, args.name)) {
      throw new ProbeError(
        "SERVICE_EXISTS",
        `service "${args.name}" already exists. Remove it first: probe rm ${args.name}`,
      );
    }
    const service: RawConfig = { port: parseInteger(String(args.port), "--port") };
    if (args.host) service.host = args.host;
    if (args.path) service.path = args.path;
    if (args.expect) service.expect = parseExpect(String(args.expect));
    if (args.timeout !== undefined) {
      secondsToMs("--timeout", String(args.timeout));
      service.timeout = Number(args.timeout);
    }

    await saveServices(loaded, { ...services, [args.name]: service });
    console.log(`Added ${args.name}. Try: probe check ${args.name}`);
  },
});
