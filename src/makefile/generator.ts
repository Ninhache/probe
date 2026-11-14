import { createHash } from "node:crypto";
import { PACKAGE_NAME } from "../constants";
import { ProbeError } from "../errors";

export const BLOCK_START = "# >>> probe (generated - do not edit, run `probe sync`)";
export const BLOCK_END = "# <<< probe";

// Matched loosely so a block written by another probe version is still found.
const START_PATTERN = /^# >>> probe\b.*$/m;
const END_PATTERN = /^# <<< probe[ \t]*$/m;

const HELP_RECIPE = `@awk -F':.*## ' '/^[a-zA-Z0-9_-]+:.*## /{printf "  %-20s %s\\n", $$1, $$2}' $(MAKEFILE_LIST)`;

/**
 * Renders the block, markers included, without trailing newline.
 * Must stay valid for GNU Make 3.81 and a POSIX shell (stock macOS).
 */
export function renderBlock(serviceNames: string[]): string {
  const targets = serviceNames.map((name) => `check-${name}`);
  const fallback = `npx -y ${PACKAGE_NAME}@latest`;
  return [
    BLOCK_START,
    `PROBE ?= $(shell command -v probe >/dev/null 2>&1 && echo probe || echo "${fallback}")`,
    `.PHONY: ${["help", "check", "status", "probe", ...targets].join(" ")}`,
    "help: ## List available targets",
    `\t${HELP_RECIPE}`,
    "check: ## Check that every service responds",
    "\t@$(PROBE) check",
    "status: ## Show probe status",
    "\t@$(PROBE) status",
    "probe: ## Open the dashboard",
    "\t@$(PROBE)",
    ...serviceNames.flatMap((name) => [
      `check-${name}: ## Check ${name}`,
      `\t@$(PROBE) check ${name}`,
    ]),
    BLOCK_END,
  ].join("\n");
}

export function hashBlock(block: string): string {
  return createHash("sha256").update(block).digest("hex");
}

function locate(makefile: string): { start: number; end: number } | null {
  const start = START_PATTERN.exec(makefile);
  if (!start) return null;
  const end = END_PATTERN.exec(makefile.slice(start.index));
  if (!end) {
    throw new ProbeError(
      "MAKEFILE_BLOCK_CORRUPT",
      `the Makefile has a probe start marker but no "${BLOCK_END}" line. Restore the marker or delete the block, then run \`probe sync\`.`,
    );
  }
  return { start: start.index, end: start.index + end.index + end[0].length };
}

export function extractBlock(makefile: string): string | null {
  const found = locate(makefile);
  return found ? makefile.slice(found.start, found.end) : null;
}

/** Returns the Makefile with its probe block replaced, or appended when it has none. */
export function replaceBlock(makefile: string | null, block: string): string {
  if (!makefile?.trim()) return `${block}\n`;
  const found = locate(makefile);
  if (found) return makefile.slice(0, found.start) + block + makefile.slice(found.end);
  return `${makefile.replace(/\n*$/, "\n\n")}${block}\n`;
}
