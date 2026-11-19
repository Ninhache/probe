import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // The CLI tests spawn several node processes each: 5 s is too short on a busy machine.
    // Room for a loaded machine: a test that passes is no slower, one that hangs fails later.
    testTimeout: 60_000,
    // Windows has no locale variable: this makes the glyphs the tests read the same on every runner.
    env: { WT_SESSION: "probe-tests" },
  },
});
