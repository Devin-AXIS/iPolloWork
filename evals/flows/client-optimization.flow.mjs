import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "client-optimization",
  title: "Client optimizations preserve composer, media, sidebar and document behavior",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Verify composer, media, layout, document and plugin behavior",
    async run(ctx) {
      let result;
      await ctx.prove("Composer editing, media integration, layout and file conversions retain their behavior", {
        voiceover: "这里验证模型准备期间仍可编辑草稿，同时检查媒体工作台、侧栏、Word、PPT 和插件包行为；这是内部状态和转换验证，不代表完整桌面流程验收。",
        action: async () => {
          result = spawnSync("bun", ["test", "--isolate", "tests/composer-queue-behavior.test.ts", "tests/design-ai-composer.test.ts", "tests/sidebar-layout-store.test.ts", "tests/sidebar-projects.test.ts", "tests/reference-ingestion.test.ts", "tests/plugin-developer-user-flow.test.ts", "tests/design-pptx-export.test.ts", "tests/pptx-element-export.test.ts", "tests/pptx-compatible-export.test.ts", "tests/pptx-entrance-animations.test.ts"], {
            cwd: fileURLToPath(new URL("../../apps/app/", import.meta.url)),
            encoding: "utf8", timeout: 55000, windowsHide: true,
          });
          ctx.output("Client optimization checks", `${result.stdout}\n${result.stderr}`);
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
