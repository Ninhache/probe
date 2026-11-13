import { build } from "tsup";

// cli.test.ts runs the real binary, so dist/ must match the sources.
export default async function setup(): Promise<void> {
  await build({ silent: true });
}
