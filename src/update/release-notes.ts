/** `info` is good to know; the others ask the user to do something or change a habit. */
export type NoteKind = "info" | "schema" | "completion" | "breaking";

export interface ReleaseNotes {
  version: string;
  items: { kind: NoteKind; text: string }[];
}

/** The kinds shown before the others, with a `!`. */
export const IMPORTANT_KINDS: readonly NoteKind[] = ["schema", "completion", "breaking"];

/**
 * What changed for the user, newest version first, 1 to 3 short lines each.
 * A release adds its entry here: a test refuses a version without notes.
 */
export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: "1.7.0",
    items: [
      {
        kind: "info",
        text: "probe add --type postgres, mysql or redis adds a database, with --user, --database and a ${VAR} --password.",
      },
      {
        kind: "completion",
        text: "probe add has new options: regenerate your saved shell completion.",
      },
    ],
  },
  {
    version: "1.6.0",
    items: [
      {
        kind: "info",
        text: "New service types postgres, mysql and redis: give host, port, user, database and a ${VAR} password, probe runs the client for you.",
      },
    ],
  },
  {
    version: "1.5.0",
    items: [
      {
        kind: "info",
        text: "Command services take env: values like ${PG_PASSWORD} come from local.yml and reach the command's environment only, never its arguments.",
      },
      {
        kind: "info",
        text: "The dashboard adds a service of any type, and edits a command as shell words.",
      },
    ],
  },
  {
    version: "1.4.0",
    items: [
      {
        kind: "info",
        text: "probe runs on Windows: PowerShell completion, doctor names the process on a port, notifications as toasts.",
      },
      {
        kind: "info",
        text: "Without make installed, probe sync, status and doctor point to probe check instead of the Makefile.",
      },
    ],
  },
  {
    version: "1.3.0",
    items: [
      {
        kind: "info",
        text: "A service can be checked by running a command: type: command, up when it exits 0 (probe add <name> --command).",
      },
      {
        kind: "completion",
        text: "probe add has new options: regenerate your saved shell completion.",
      },
    ],
  },
  {
    version: "1.2.0",
    items: [
      {
        kind: "info",
        text: "probe --help is grouped and colored; in the dashboard, ? shows the keys of the current screen first.",
      },
      {
        kind: "info",
        text: "probe tells you once what changed after an update (Shift+w in the dashboard).",
      },
      {
        kind: "info",
        text: "PROBE_ASCII=1 draws the dashboard and the command output with ASCII only.",
      },
    ],
  },
  {
    version: "1.1.0",
    items: [{ kind: "info", text: "In the dashboard, w saves the response to .probe/traces/." }],
  },
  {
    version: "1.0.0",
    items: [
      {
        kind: "info",
        text: "New dashboard: edit services, variables and environments in place.",
      },
      { kind: "info", text: "In the dashboard, ? searches the keys as you type." },
    ],
  },
];
