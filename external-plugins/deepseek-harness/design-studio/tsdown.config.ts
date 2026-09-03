import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { createStudioBuild } from "../studio-host/tsdown.ts";

const sourcePluginRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig(createStudioBuild({
  clientId: "deepseek-idesign",
  outputPluginRoot: sourcePluginRoot,
  nodeEntry: resolve(sourcePluginRoot, "src/index.ts"),
  clientEntry: resolve(sourcePluginRoot, "src/client.tsx"),
}));
