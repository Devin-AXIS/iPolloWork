import { resolve } from "node:path";
import type { UserConfig } from "tsdown";

const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
];

export type StudioBuildOptions = {
  clientId: string;
  outputPluginRoot: string;
  nodeEntry: string;
  clientEntry: string;
  nodeEntries?: Record<string, string>;
};

export function createStudioBuild(options: StudioBuildOptions): UserConfig[] {
  return [
    {
      name: options.clientId,
      entry: { index: options.nodeEntry, ...options.nodeEntries },
      outDir: resolve(options.outputPluginRoot, "lib"),
      format: "esm",
      platform: "node",
      target: "es2024",
      fixedExtension: false,
      dts: false,
      clean: true,
      deps: { neverBundle: [/^@deepseek-ai\//, "hyperframes"] },
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
  ];
}
