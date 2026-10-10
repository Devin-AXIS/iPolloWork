import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sharedUiRoot = fileURLToPath(new URL("../../../../packages/ui", import.meta.url));
const sharedUiPackage = JSON.parse(readFileSync(join(sharedUiRoot, "package.json"), "utf8"));

// Unit tests consume workspace sources; they must not boot the Studio server
// or require a complete rendered-media build through vite.config.ts.
export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    conditions: ["bun", "import"],
    alias: {
      react: join(sharedUiRoot, "node_modules/react"),
      "react-dom": join(sharedUiRoot, "node_modules/react-dom"),
      ...Object.fromEntries(["controls", "select", "alert", "tabs", "field", "radio-group", "tooltip", "dropdown-menu"].map(name => [
        `@ipollowork/ui/${name}`, join(sharedUiRoot, sharedUiPackage.exports[`./${name}`]),
      ])),
      "@ipollowork/types/hyperframes": fileURLToPath(new URL("../../../../packages/types/src/hyperframes.ts", import.meta.url)),
      "@ipollowork/types/video-image-workbench": fileURLToPath(
        new URL("../../../../packages/types/src/video-image-workbench.ts", import.meta.url),
      ),
    },
  },
  test: {
    server: { deps: { inline: [/@base-ui\//, /zustand/] } },
    exclude: ["data/**", "node_modules/**", "dist/**"],
    setupFiles: ["src/test-setup.ts"],
    maxWorkers: 1,
  },
});
