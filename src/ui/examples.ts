/** A command line shown in the help, with what it does. */
export interface Example {
  command: string;
  note: string;
}

const ROOT = "probe";
const GAP = "  ";
const INDENT = "  ";
const ESC = "\u001b";

/** Examples shown at the end of the help, by command name (`probe` for the help of `probe` itself). */
export const EXAMPLES: Record<string, Example[]> = {
  [ROOT]: [
    { command: "probe init", note: "Start in this project" },
    { command: "probe add api -p 3000 --path /health", note: "Declare a service" },
    { command: "probe check", note: "Check every service" },
    { command: "probe wait && pnpm test", note: "Run the tests once all are up" },
    { command: "probe", note: "Open the dashboard (on a terminal)" },
  ],
  init: [{ command: "probe init", note: "Create .probe/ in this directory" }],
  add: [
    { command: "probe add api -p 3000", note: "http://localhost:3000/" },
    { command: "probe add api -p 3000 --path /health", note: "Check another path" },
    { command: "probe add admin -p 8080 --expect 200,204", note: "Accept these statuses only" },
    { command: "probe add db -p 5432 --timeout 10", note: "Give it 10 s to answer" },
  ],
  rm: [{ command: "probe rm api", note: "Remove the service named api" }],
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
  status: [{ command: "probe status", note: "Version, migration, Makefile block" }],
  sync: [{ command: "probe sync", note: "Write the probe block of the Makefile" }],
  migrate: [{ command: "probe migrate", note: "Bring .probe/config.yml up to date" }],
  completion: [
    { command: "probe completion zsh", note: 'In ~/.zshrc: eval "$(probe completion zsh)"' },
    { command: "probe completion bash", note: 'In ~/.bashrc: eval "$(probe completion bash)"' },
  ],
};

/**
 * Renders the EXAMPLES section of a command's help, styled like the sections citty prints.
 * Returns an empty string for a command without examples.
 */
export function formatExamples(name: string | undefined, color: boolean): string {
  const examples = EXAMPLES[name ?? ROOT] ?? [];
  if (examples.length === 0) return "";
  const style = (open: string, close: string) => (text: string) =>
    color ? `${ESC}[${open}m${text}${ESC}[${close}m` : text;
  const title = style("1;4", "22;24");
  const cyan = style("36", "39");
  const width = Math.max(...examples.map((example) => example.command.length));
  const lines = examples.map(
    ({ command, note }) => `${INDENT}${cyan(command.padEnd(width))}${GAP}${note}`,
  );
  return [title("EXAMPLES"), "", ...lines].join("\n");
}
