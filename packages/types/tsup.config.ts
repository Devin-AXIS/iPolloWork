import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "den/desktop-app-restrictions": "src/den/desktop-app-restrictions.ts",
    "den/desktop-policies": "src/den/desktop-policies.ts",
    "den/inference": "src/den/inference.ts",
    "deepseek-official-models": "src/deepseek-official-models.ts",
    hyperframes: "src/hyperframes.ts",
    "hyperframes-project": "src/hyperframes-project.ts",
    "opencode-zen-public-models": "src/opencode-zen-public-models.ts",
    plugins: "src/plugins.ts",
    "provider-credentials": "src/provider-credentials.ts",
    "project-workspace": "src/project-workspace.ts",
    templates: "src/templates.ts",
    "work-items": "src/work-items.ts",
    workspace: "src/workspace.ts",
  },
  tsconfig: "./tsconfig.json",
  format: ["esm"],
  dts: {
    tsconfig: "./tsconfig.json",
  },
  clean: true,
  target: "es2022",
  platform: "neutral",
  sourcemap: false,
  splitting: false,
  treeshake: true,
  external: ["zod"],
})
