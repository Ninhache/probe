import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // The CLI tests spawn several node processes each: 5 s is too short on a busy machine.
    testTimeout: 20_000,
  },
});
