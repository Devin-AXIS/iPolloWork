import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "client-optimization",
  title: "Sidebar persistence and on-demand document/plugin imports retain their behavior",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Verify layout persistence, document extraction and plugin archives",
    async run(ctx) {
      let result;
      await ctx.prove("Repeated layout operations avoid writes while real layout changes and file imports still work", {
        voiceover: "这里验证重复排序不会反复存盘，真实移动、清理和重新加载仍保留正确布局，同时确认 Word、PPT 和插件包可以正常读取；这是状态和文件验证，不代表完整桌面流程验收。",
        action: async () => {
          result = spawnSync("bun", ["test", "--isolate", "tests/sidebar-layout-store.test.ts", "tests/sidebar-projects.test.ts", "tests/reference-ingestion.test.ts", "tests/plugin-developer-user-flow.test.ts"], {
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
