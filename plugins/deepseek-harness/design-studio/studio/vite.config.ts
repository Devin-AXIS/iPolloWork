import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(pluginRoot, "../../..");
const appRoot = resolve(repositoryRoot, "apps/app");

export default defineConfig({
  root: resolve(pluginRoot, "studio"),
  base: "./",
  plugins: [tailwindcss(), react()],
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
    outDir: resolve(pluginRoot, "studio/dist"),
    emptyOutDir: true,
    target: "es2022",
  },
});
