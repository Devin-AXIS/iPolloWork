import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "client-optimization",
  title: "Sidebar persistence, document imports and PPTX conversion retain their behavior",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Verify layout persistence, document extraction, PPTX conversion and plugin archives",
    async run(ctx) {
      let result;
      await ctx.prove("Layout changes and file imports work, and shared PPTX color conversion preserves export behavior", {
        voiceover: "这里验证侧栏布局、Word、PPT 和插件包读取，并确认合并颜色解析后，PPT 的透明度、默认颜色和可编辑元素导出仍然正确；这是状态和转换验证，不代表完整桌面流程验收。",
        action: async () => {
          result = spawnSync("bun", ["test", "--isolate", "tests/sidebar-layout-store.test.ts", "tests/sidebar-projects.test.ts", "tests/reference-ingestion.test.ts", "tests/plugin-developer-user-flow.test.ts", "tests/design-pptx-export.test.ts", "tests/pptx-element-export.test.ts", "tests/pptx-compatible-export.test.ts", "tests/pptx-entrance-animations.test.ts"], {
            cwd: fileURLToPath(new URL("../../apps/app/", import.meta.url)),
            encoding: "utf8", timeout: 55000, windowsHide: true,
          });
          ctx.output("Sidebar and file-import checks", `${result.stdout}\n${result.stderr}`);
        },
        assert: async () => {
          const output = `${result.stdout}\n${result.stderr}`;
          ctx.assert(result.status === 0, result.error?.message ?? "Regression checks completed successfully");
          ctx.assert(/\b[1-9]\d* pass\b/.test(output) && /\b0 fail\b/.test(output), "Regression cases ran and all passed");
        },
      });
    },
  }],
};
