import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesignStudioBuild } from "../design-studio/tsdown.config.ts";

const pluginRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default createDesignStudioBuild({
  clientId: "deepseek-ippt",
  outputPluginRoot: pluginRoot,
  nodeEntry: resolve(pluginRoot, "src/index.ts"),
  clientEntry: resolve(pluginRoot, "src/client.tsx"),
});
