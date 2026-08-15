import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  isCustomerVisibleBundledTemplate,
  templateManifestV1Schema,
} from "../../../../packages/types/src/templates";
import type { DeepSeekDesignStudioMode } from "../src/index";

const sourcePluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(sourcePluginRoot, "../../..");
const appRoot = resolve(repositoryRoot, "apps/app");

export type DesignStudioViteOptions = {
  mode: DeepSeekDesignStudioMode;
  studioTitle: string;
  outputPluginRoot: string;
};

function copyTemplates(options: DesignStudioViteOptions): PluginOption {
  return {
    name: "ipollowork-design-studio-templates",
    transformIndexHtml(html) {
      return html.replace("iPolloWork Design Studio", `iPolloWork ${options.studioTitle}`);
    },
    async closeBundle() {
      const sourceRoot = resolve(repositoryRoot, "apps/server/bundled-templates");
      const destinationRoot = resolve(options.outputPluginRoot, "lib/templates");
      await rm(destinationRoot, { recursive: true, force: true });
      await mkdir(destinationRoot, { recursive: true });
      for (const name of await readdir(sourceRoot)) {
        const directory = resolve(sourceRoot, name);
        if (!(await stat(directory)).isDirectory()) continue;
        const parsed = templateManifestV1Schema.safeParse(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
        if (!parsed.success || parsed.data.surface !== "design" || !isCustomerVisibleBundledTemplate(parsed.data)) continue;
        const allowed = options.mode === "slides" ? parsed.data.category === "slides" : parsed.data.category !== "slides";
        if (allowed) await cp(directory, resolve(destinationRoot, name), { recursive: true, errorOnExist: true });
      }
    },
  };
}

export function createDesignStudioViteConfig(options: DesignStudioViteOptions) {
  return defineConfig({
    root: resolve(sourcePluginRoot, "studio"),
    base: "./",
    plugins: [copyTemplates(options), tailwindcss(), react()],
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
