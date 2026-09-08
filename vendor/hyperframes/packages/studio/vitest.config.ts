import { defineConfig } from "vitest/config";

// Unit tests consume workspace sources; they must not boot the Studio server
// or require a complete rendered-media build through vite.config.ts.
export default defineConfig({
  resolve: { conditions: ["bun", "import"] },
  test: {
    exclude: ["data/**", "node_modules/**", "dist/**"],
    setupFiles: ["src/test-setup.ts"],
    maxWorkers: 1,
  },
});
