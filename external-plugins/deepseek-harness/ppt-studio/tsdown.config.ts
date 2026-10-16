import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { createStudioBuild } from "../studio-host/tsdown.ts";

const pluginRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig(createStudioBuild({
  clientId: "deepseek-ippt",
  outputPluginRoot: pluginRoot,
  nodeEntry: resolve(pluginRoot, "src/index.ts"),
  clientEntry: resolve(pluginRoot, "src/client.tsx"),
}));
