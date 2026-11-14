import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // The interactive libraries are bundled into lazy chunks: installing probe stays three packages.
  noExternal: ["ink", "react", /^@clack\//, "sisteransi", "fast-string-width", "fast-wrap-ansi"],
  // ink imports it only when DEV=true and the package is installed.
  external: ["react-devtools-core"],
  // The bundled libraries have CommonJS parts that call `require` on Node built-ins.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  define: {
    __PROBE_VERSION__: JSON.stringify(version),
    // Keeps react's development build out of the bundle.
    "process.env.NODE_ENV": '"production"',
  },
});
