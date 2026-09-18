import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { isCustomerVisibleBundledTemplate } from "../../../../packages/types/src/templates";
import { createBundledTemplateCopyPlugin } from "../../studio-host/build.ts";
import type { DeepSeekDesignStudioMode } from "../src/index";

const sourcePluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(sourcePluginRoot, "../../..");
const appRoot = resolve(repositoryRoot, "apps/app");

export type DesignStudioViteOptions = {
  mode: DeepSeekDesignStudioMode;
  studioTitle: string;
  outputPluginRoot: string;
};

export function createDesignStudioViteConfig(options: DesignStudioViteOptions) {
  return defineConfig({
    root: resolve(sourcePluginRoot, "studio"),
    base: "./",
    plugins: [
      createBundledTemplateCopyPlugin({
        repositoryRoot,
        outputPluginRoot: options.outputPluginRoot,
        name: "ipollowork-design-studio-templates",
        indexTitle: `iPolloWork ${options.studioTitle}`,
        allows: (manifest) => manifest.surface === "design"
          && isCustomerVisibleBundledTemplate(manifest)
          && (options.mode === "slides" ? manifest.category === "slides" : manifest.category !== "slides"),
      }),
      tailwindcss(),
      react(),
    ],
    define: {
      __DEEPSEEK_STUDIO_MODE__: JSON.stringify(options.mode),
      __DEEPSEEK_STUDIO_TITLE__: JSON.stringify(options.studioTitle),
    },
    resolve: {
      alias: {
        "@": resolve(appRoot, "src"),
        "@ipollowork/design-studio": resolve(repositoryRoot, "packages/design-studio/src/index.ts"),
        "@ipollowork/types/templates": resolve(repositoryRoot, "packages/types/src/templates.ts"),
        "react": resolve(appRoot, "node_modules/react"),
        "react-dom": resolve(appRoot, "node_modules/react-dom"),
        "@tanstack/react-query": resolve(appRoot, "node_modules/@tanstack/react-query"),
      },
    },
    build: {
      outDir: resolve(options.outputPluginRoot, "studio/dist"),
      emptyOutDir: true,
      target: "es2022",
    },
  });
}

export default createDesignStudioViteConfig({
  mode: "design",
  studioTitle: "DeepSeek iDesign",
  outputPluginRoot: sourcePluginRoot,
});
