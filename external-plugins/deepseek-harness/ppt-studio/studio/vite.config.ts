import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesignStudioViteConfig } from "../../design-studio/studio/vite.config.ts";

const pluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export default createDesignStudioViteConfig({
  mode: "slides",
  studioTitle: "DeepSeek iPPT",
  outputPluginRoot: pluginRoot,
});
