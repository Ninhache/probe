import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    globalSetup: ["test/global-setup.ts"],
    // The CLI tests spawn several node processes each: 5 s is too short on a busy machine.
    // Room for a loaded machine: a test that passes is no slower, one that hangs fails later.
    testTimeout: 60_000,
  },
});
