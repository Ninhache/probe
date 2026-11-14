import { serviceName } from "../shared";
import type { Candidate, Source } from "../types";

const MANIFEST = "package.json";
const SCRIPT_PORT = /(?:--port[= ]|-p |\bPORT=)(\d{2,5})\b/;
// Port a dev server listens on when its script names none.
const TOOL_PORTS: [tool: RegExp, port: number][] = [
  [/\bvite\b/, 5173],
  [/\bnext\b/, 3000],
  [/\bnuxt\b/, 3000],
  [/\bastro\b/, 4321],
  [/\bng serve\b/, 4200],
];
// Scripts that start the project itself: they take its name, not theirs.
const MAIN_SCRIPTS = ["dev", "start", "serve"];

function inManifest(text: string): Candidate[] {
  let manifest: { name?: unknown; scripts?: unknown };
  try {
    manifest = JSON.parse(text);
  } catch {
    return [];
  }
  if (!manifest.scripts || typeof manifest.scripts !== "object") return [];
  const project = typeof manifest.name === "string" ? manifest.name.replace(/^@[^/]*\//, "") : "";
  const found: Candidate[] = [];
  for (const [script, command] of Object.entries(manifest.scripts)) {
    if (typeof command !== "string") continue;
    const main = MAIN_SCRIPTS.includes(script);
    const named = SCRIPT_PORT.exec(command)?.[1];
    const usual = main ? TOOL_PORTS.find(([tool]) => tool.test(command))?.[1] : undefined;
    const port = named ? Number(named) : usual;
    if (port === undefined) continue;
    const name = serviceName(main ? project : script);
    found.push({ name, service: { port }, source: `${MANIFEST} (${script} script)` });
  }
  return found;
}

/** The port a script of `package.json` names, or the usual one of its dev server. */
export const packageJsonSource: Source = {
  id: "package-json",
  async find({ read }) {
    const text = await read(MANIFEST);
    return text === null ? [] : inManifest(text);
  },
};
