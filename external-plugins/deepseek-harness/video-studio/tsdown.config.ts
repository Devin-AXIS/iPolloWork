import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { createStudioBuild } from "../studio-host/tsdown.ts";

const pluginRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig(createStudioBuild({
  clientId: "deepseek-ivideo",
  outputPluginRoot: pluginRoot,
  nodeEntry: resolve(pluginRoot, "src/index.ts"),
  clientEntry: resolve(pluginRoot, "src/client.tsx"),
  nodeEntries: {
    runtime: resolve(pluginRoot, "src/runtime.ts"),
    "preview-owner-guard": resolve(pluginRoot, "src/preview-owner-guard.ts"),
    contract: resolve(pluginRoot, "../../../packages/video-studio/src/index.ts"),
  },
}));
