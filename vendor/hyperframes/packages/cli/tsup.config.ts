import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    runtimeVersion: "src/runtimeVersion.ts",
    shaderTransitionWorker: "../producer/src/services/shaderTransitionWorker.ts",
  },
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  banner: {
    js: `import { createRequire as __hf_createRequire } from "node:module";
import { fileURLToPath as __hf_fileURLToPath } from "node:url";
import { dirname as __hf_dirname } from "node:path";
var require = __hf_createRequire(import.meta.url);
var __filename = __hf_fileURLToPath(import.meta.url);
var __dirname = __hf_dirname(__filename);`,
  },
  external: [
    "puppeteer-core",
    "puppeteer",
    "@puppeteer/browsers",
    // Native module — its platform binary (@img/sharp-<os>-<arch>) must be
    // resolved from node_modules at runtime, never bundled. Loaded lazily by
    // the capture pipeline; runtime resolution comes from the `dependencies`
    // entry in package.json.
    "sharp",
    "open",
    "hono",
    "hono/*",
    "@hono/node-server",
    "adm-zip",
    "esbuild",
    "giget",
    "postcss",
  ],
  noExternal: [
    "@hyperframes/core",
    "@hyperframes/parsers",
    "@hyperframes/studio-server",
    "@hyperframes/lint",
    "@hyperframes/producer",
    "@hyperframes/engine",
    "@clack/prompts",
    "@clack/core",
    "picocolors",
    "linkedom",
    "sisteransi",
    "is-unicode-supported",
    "citty",
  ],
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.alias = {
      "@hyperframes/producer": resolve(__dirname, "../producer/src/index.ts"),
      // esbuild's alias map treats `@hyperframes/producer` as a file path
      // and would otherwise resolve `@hyperframes/producer/distributed`
      // to `../producer/src/index.ts/distributed` (treating the file as a
      // directory). Adding an explicit alias for every subpath we import
      // avoids the prefix-substitution misfire.
      "@hyperframes/producer/distributed": resolve(__dirname, "../producer/src/distributed.ts"),
      // hf#677 follow-up: the shader-blend worker imports from
      // `@hyperframes/engine/shader-transitions` (subpath export) — a
      // standalone TS file with zero internal imports that survives the
      // worker_thread loader boundary.
      "@hyperframes/engine/shader-transitions": resolve(
        __dirname,
        "../engine/src/utils/shaderTransitions.ts",
      ),
    };
    options.loader = { ...options.loader, ".browser.js": "text" };
  },
});
