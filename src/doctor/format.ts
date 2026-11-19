import type { Colors } from "../ui/colors";
import { type Glyphs, UNICODE_GLYPHS } from "../ui/glyphs";
import type { DockerCheck, ServiceChecks, ServiceReport } from "./diagnose";

const INDENT = "    ";
const STARTABLE = new Set(["exited", "created"]);

function portLine({ port, process }: ServiceChecks): string {
  if (port.status === "closed") return "nothing listens on it";
  switch (process.status) {
    case "found":
      return `${process.name} (pid ${process.pid}) listens on it`;
    case "hidden":
      return "something listens on it, owned by another user or a container";
    case "skipped":
      return `something listens on it (owner skipped: ${process.reason})`;
    case "none":
      return "something listens on it";
  }
}

function dockerLine(docker: DockerCheck, glyphs: Glyphs): string {
  if (docker.status === "skipped") return `skipped: ${docker.reason}`;
  if (docker.status === "none") return "no container publishes this port";
  return (docker.containers ?? [])
    .map(({ name, state }) => {
      const start = STARTABLE.has(state) ? ` ${glyphs.arrow} docker start ${name}` : "";
      return `container ${name} (${state}) publishes this port${start}`;
    })
    .join(`\n${INDENT}${" ".repeat(LABEL_WIDTH + 1)}`);
}

const LABEL_WIDTH = 10;

/** The lines shown under a down service, empty for a service that needs none. */
export function formatDiagnosis(
  service: ServiceReport,
  colors: Colors,
  glyphs: Glyphs = UNICODE_GLYPHS,
): string[] {
  const { checks } = service;
  if (!checks) return [];
  const line = (label: string, text: string, tone: (text: string) => string) =>
    `${INDENT}${colors.dim(label.padEnd(LABEL_WIDTH))} ${tone(text)}`;
  if (checks.port.status === "skipped") {
    return [line("local", `skipped: ${checks.port.reason}`, colors.dim)];
  }
  const dockerTone =
    checks.docker.status === "stopped"
      ? colors.yellow
      : checks.docker.status === "running"
        ? (text: string) => text
        : colors.dim;
  return [
    line(`port ${service.port}`, portLine(checks), (text) => text),
    line("docker", dockerLine(checks.docker, glyphs), dockerTone),
  ];
}
