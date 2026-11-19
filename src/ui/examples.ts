export interface Example {
  command: string;
  note: string;
}

import { reference } from "../config/headers";
import { createColors } from "./colors";

const GAP = "  ";
const INDENT = "  ";
// A few are enough: the help has to stay short.
const MAX_EXAMPLES = 3;

export const EXAMPLES: Record<string, Example[]> = {
  init: [{ command: "probe init", note: "Create .probe/ in this directory" }],
  add: [
    { command: "probe add api -p 3000", note: "http://localhost:3000/" },
    { command: "probe add api -p 3000 --path /health", note: "Check another path" },
    { command: "probe add admin -p 8080 --expect 200,204", note: "Accept these statuses only" },
    { command: "probe add db -p 5432 --timeout 10", note: "Give it 10 s to answer" },
    { command: "probe add hook -p 8080 -X POST", note: "Send a POST instead of a GET" },
    { command: "probe add api -p 3000 --hint 'run: make api'", note: "Say what to do when down" },
    {
      command: `probe add api -p 3000 -H 'X-Api-Key: ${reference("API_KEY")}'`,
      note: "Send a header",
    },
  ],
  rm: [
    { command: "probe rm api", note: "Remove the service named api" },
    { command: "probe rm api --yes", note: "Remove it without the question" },
  ],
  ls: [{ command: "probe ls", note: "List the services and their URL" }],
  check: [
    { command: "probe check", note: "Check every service" },
    { command: "probe check api db", note: "Check these two only" },
    { command: "probe check --json", note: "Print the results as JSON" },
    { command: "probe check --timeout 10", note: "Give each service 10 s" },
  ],
  wait: [
    { command: "probe wait && pnpm test", note: "Run the tests once all are up" },
    { command: "probe wait api --timeout 120", note: "Wait for api, 2 minutes at most" },
    { command: "probe wait --interval 1 --max-interval 10", note: "Check less often" },
  ],
  open: [{ command: "probe open front", note: "Open the URL of front in the browser" }],
  curl: [
    { command: "probe curl api", note: "Print the curl command for api" },
    { command: "probe curl api | sh", note: "Run it" },
  ],
  var: [
    { command: "probe var", note: "List the variables the headers use" },
    { command: "probe var API_KEY", note: "Type its value, kept in .probe/local.yml" },
    { command: "probe var API_KEY < key.txt", note: "Read the value from a file or a pipe" },
    { command: "probe var API_KEY --unset", note: "Forget it" },
  ],
  status: [{ command: "probe status", note: "Version, migration, Makefile block" }],
  doctor: [
    { command: "probe doctor", note: "Project state, and who holds a down port" },
    { command: "probe doctor api --json", note: "One service, for a script" },
  ],
  sync: [{ command: "probe sync", note: "Write the probe block of the Makefile" }],
  migrate: [{ command: "probe migrate", note: "Bring .probe/config.yml up to date" }],
  completion: [
    { command: "probe completion zsh", note: 'In ~/.zshrc: eval "$(probe completion zsh)"' },
    { command: "probe completion bash", note: 'In ~/.bashrc: eval "$(probe completion bash)"' },
    { command: "probe completion fish | source", note: "In ~/.config/fish/config.fish" },
  ],
};

export function formatExamples(name: string | undefined, color: boolean): string {
  const examples = (name === undefined ? undefined : EXAMPLES[name])?.slice(0, MAX_EXAMPLES) ?? [];
  if (examples.length === 0) return "";
  const { bold, cyan } = createColors(color);
  const width = Math.max(...examples.map((example) => example.command.length));
  const lines = examples.map(
    ({ command, note }) => `${INDENT}${cyan(command.padEnd(width))}${GAP}${note}`,
  );
  return [bold("Examples"), ...lines].join("\n");
}
