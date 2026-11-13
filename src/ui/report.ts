import { targetUrl } from "../checkers/http";
import type { CheckResult } from "../checkers/types";
import type { Config } from "../config/schema";
import type { Colors } from "./colors";

function width(values: string[]): number {
  return Math.max(0, ...values.map((value) => value.length));
}

export function formatCheckResults(results: CheckResult[], colors: Colors): string {
  const nameWidth = width(results.map((result) => result.name));
  const targetWidth = width(results.map((result) => result.target));
  return results
    .map((result) => {
      const mark = result.ok ? colors.green("✓") : colors.red("✗");
      const name = colors.bold(result.name.padEnd(nameWidth));
      const target = colors.dim(result.target.padEnd(targetWidth));
      const outcome = result.ok
        ? `${colors.green(String(result.status))}  ${colors.dim(`${result.latencyMs}ms`)}`
        : colors.red(result.error ?? "down");
      return `${mark} ${name}  ${target}  ${outcome}`;
    })
    .join("\n");
}

export function formatServices(config: Config, colors: Colors): string {
  const entries = Object.entries(config.services);
  const nameWidth = width(entries.map(([name]) => name));
  return entries
    .map(([name, service]) => {
      const expect = service.expect === undefined ? "" : colors.dim(`  expect ${service.expect}`);
      return `${colors.bold(name.padEnd(nameWidth))}  ${targetUrl(service)}${expect}`;
    })
    .join("\n");
}
