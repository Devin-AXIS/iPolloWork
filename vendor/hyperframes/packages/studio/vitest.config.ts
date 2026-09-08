import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests consume workspace sources; they must not boot the Studio server
// or require a complete rendered-media build through vite.config.ts.
export default defineConfig({
  resolve: {
    conditions: ["bun", "import"],
    alias: {
      "@ipollowork/types/video-image-workbench": fileURLToPath(
        new URL("../../../../packages/types/src/video-image-workbench.ts", import.meta.url),
      ),
    },
  },
  test: {
    exclude: ["data/**", "node_modules/**", "dist/**"],
    setupFiles: ["src/test-setup.ts"],
    maxWorkers: 1,
  },
});
