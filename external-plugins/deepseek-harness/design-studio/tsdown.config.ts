import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const sourcePluginRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const CLIENT_EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis"];

export type DesignStudioBuildOptions = {
  clientId: string;
  outputPluginRoot: string;
  nodeEntry: string;
  clientEntry: string;
};

export function createDesignStudioBuild(options: DesignStudioBuildOptions) {
  return defineConfig([
    {
      name: options.clientId,
      entry: { index: options.nodeEntry },
      outDir: resolve(options.outputPluginRoot, "lib"),
      format: "esm",
      platform: "node",
      target: "es2024",
      fixedExtension: false,
      dts: false,
      clean: true,
      deps: { neverBundle: [/^@deepseek-ai\//] },
    },
    {
      name: `${options.clientId}/client`,
      entry: { client: options.clientEntry },
      outDir: resolve(options.outputPluginRoot, "lib"),
      format: "cjs",
      platform: "browser",
      target: "es2022",
      dts: false,
      sourcemap: true,
      clean: false,
      deps: { neverBundle: CLIENT_EXTERNALS },
      define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production") },
      outputOptions: {
        entryFileNames: "client.js",
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(options.clientId)}, factory: (require) => {`,
        footer: "return module.exports; } });",
        intro: "var module = { exports: {} }; var exports = module.exports;",
      },
    },
  ]);
}

export default createDesignStudioBuild({
  clientId: "deepseek-idesign",
  outputPluginRoot: sourcePluginRoot,
  nodeEntry: resolve(sourcePluginRoot, "src/index.ts"),
  clientEntry: resolve(sourcePluginRoot, "src/client.tsx"),
});
