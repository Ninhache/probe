import { text } from "node:stream/consumers";
import { defineCommand } from "citty";
import { reference, VARIABLE_NAME, variableValueProblem } from "../config/headers";
import { readLocalVariables, variableSource, writeVariable } from "../config/local";
import type { Config } from "../config/schema";
import { serviceVariables } from "../config/schema";
import { LOCAL_FILE, PROBE_DIR } from "../constants";
import { ProbeError } from "../errors";
import { askSecret } from "../ui/prompt";
import { isInteractive } from "../ui/terminal";
import { ignoreLocalFiles } from "./init";
import { ENVIRONMENT_ARG, openProject } from "./shared";

const LOCAL = `${PROBE_DIR}/${LOCAL_FILE}`;

export function usedVariables(config: Config): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const [service, definition] of Object.entries(config.services)) {
    for (const name of serviceVariables(definition))
      used.set(name, [...(used.get(name) ?? []), service]);
  }
  return used;
}

const unreadable = () =>
  new ProbeError("CONFIG_INVALID", `${LOCAL} is not valid YAML: fix it, then run this again.`);

const flag = (environment: string | undefined) =>
  environment === undefined ? "" : ` --env ${environment}`;
const forEnvironment = (environment: string | undefined) =>
  environment === undefined ? "" : ` for ${environment}`;

function listing(
  used: Map<string, string[]>,
  local: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv,
  environment: string | undefined,
): string {
  const names = [...new Set([...used.keys(), ...Object.keys(local)])];
  const width = Math.max(...names.map((name) => name.length));
  const where = {
    environment: "set in the environment",
    local: `set in ${LOCAL}${forEnvironment(environment)}`,
  };
  return names
    .map((name) => {
      const source = variableSource(name, local, env);
      const state = source ? where[source] : `not set: probe var ${name}${flag(environment)}`;
      const services = used.get(name);
      const users = services ? `used by ${services.join(", ")}` : "used by no service";
      return `${name.padEnd(width)}  ${state}  (${users})`;
    })
    .join("\n");
}

// Never from the command line: the shell history and `ps` would keep it.
async function readValue(name: string, environment: string | undefined): Promise<string | null> {
  const problem = (value: string) => {
    const reason = variableValueProblem(value);
    return reason && `${name} expects ${reason}.`;
  };
  if (!process.stdin.isTTY) {
    const value = (await text(process.stdin)).replace(/\r?\n$/, "");
    const reason = problem(value);
    if (reason) throw new ProbeError("USAGE", reason);
    return value;
  }
  if (!isInteractive(process.stdin, process.stdout, process.env)) {
    throw new ProbeError(
      "USAGE",
      `give the value on stdin, e.g. printf %s "$${name}" | probe var ${name}${flag(environment)}`,
    );
  }
  return askSecret(`Value of ${name}${forEnvironment(environment)} (not shown)`, problem);
}

export default defineCommand({
  meta: {
    name: "var",
    description: "Set a variable the headers refer to, on this machine",
  },
  args: {
    name: { type: "positional", description: "Variable name, e.g. API_TOKEN", required: false },
    unset: { type: "boolean", description: "Forget the value kept for this variable" },
    env: {
      ...ENVIRONMENT_ARG,
      description: "Keep the value for the environment <name> only, instead of the local services",
    },
  },
  async run({ args }) {
    const { config, paths } = await openProject(args.env);
    const { environment } = paths;
    const used = usedVariables(config);
    const local = await readLocalVariables(paths);
    const { name } = args;

    if (name === undefined) {
      if (args.unset)
        throw new ProbeError("USAGE", "--unset expects a name: probe var NAME --unset");
      if (local.unreadable)
        console.error(`probe: ${LOCAL} is not valid YAML: what it sets is not read.`);
      if (used.size === 0 && Object.keys(local.values).length === 0) {
        console.log(
          `No variable yet. A header refers to one as ${reference("NAME")}: probe add --help`,
        );
        return;
      }
      console.log(listing(used, local.values, process.env, environment));
      return;
    }

    if (!VARIABLE_NAME.test(name)) {
      throw new ProbeError(
        "USAGE",
        "a variable name is made of letters, digits and _, e.g. API_TOKEN.",
      );
    }
    if (local.unreadable) throw unreadable();

    if (args.unset) {
      if (!Object.hasOwn(local.values, name)) {
        console.log(
          `${name} is not kept in ${LOCAL}${forEnvironment(environment)}: nothing to forget.`,
        );
        return;
      }
      if (!(await writeVariable(paths, name, undefined))) throw unreadable();
      console.log(`Forgot ${name}${forEnvironment(environment)}.`);
      return;
    }

    const value = await readValue(name, environment);
    if (value === null) {
      console.log("Nothing kept.");
      return;
    }
    // Before the value is written: the file that holds it must never be committed.
    await ignoreLocalFiles(paths.root);
    if (!(await writeVariable(paths, name, value))) throw unreadable();
    console.log(`Kept ${name} in ${LOCAL}${forEnvironment(environment)}, for this machine only.`);
    if (process.env[name]) {
      console.error(`probe: the environment sets ${name} too, and is read first.`);
    }
    if (!used.has(name)) {
      console.error(
        `probe: no service sends ${name} yet. A header refers to it as ${reference(name)}.`,
      );
    }
  },
});
