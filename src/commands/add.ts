import { defineCommand } from "citty";
import type { RawConfig } from "../config/migrations";
import { DEFAULT_TIMEOUT_SECONDS } from "../constants";
import { ProbeError } from "../errors";
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
