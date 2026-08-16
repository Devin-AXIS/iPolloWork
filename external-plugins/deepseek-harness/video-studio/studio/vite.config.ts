import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createBundledTemplateCopyPlugin } from "../../studio-host/build.ts";

const pluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(pluginRoot, "../../..");
const appRoot = resolve(repositoryRoot, "apps/app");

export default defineConfig({
  root: resolve(pluginRoot, "studio"),
  base: "./",
  plugins: [
    createBundledTemplateCopyPlugin({
      repositoryRoot,
      outputPluginRoot: pluginRoot,
      name: "ipollowork-video-studio-templates",
      allows: (manifest) => manifest.surface === "video" && manifest.category === "video",
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@": resolve(appRoot, "src"),
      "@ipollowork/video-studio/bridge": resolve(repositoryRoot, "packages/video-studio/src/bridge.ts"),
      "@ipollowork/video-studio/host": resolve(repositoryRoot, "packages/video-studio/src/host.ts"),
      "@ipollowork/video-studio/project": resolve(repositoryRoot, "packages/video-studio/src/project.ts"),
      "@ipollowork/video-studio": resolve(repositoryRoot, "packages/video-studio/src/index.ts"),
      "@ipollowork/types/templates": resolve(repositoryRoot, "packages/types/src/templates.ts"),
      "@ipollowork/types/hyperframes-project": resolve(repositoryRoot, "packages/types/src/hyperframes-project.ts"),
      "react": resolve(appRoot, "node_modules/react"),
      "react-dom": resolve(appRoot, "node_modules/react-dom"),
      "@tanstack/react-query": resolve(appRoot, "node_modules/@tanstack/react-query"),
    },
  },
  build: {
    outDir: resolve(pluginRoot, "studio/dist"),
    emptyOutDir: true,
    target: "es2022",
  },
});
