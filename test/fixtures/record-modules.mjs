// Preloaded with `node --import`: appends the URL of every module the process resolves to a file.
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";

const file = process.env.PROBE_TEST_MODULES_FILE;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (file) appendFileSync(file, `${resolved.url}\n`);
    return resolved;
  },
});
