import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "video-console-contracts",
  title: "Video Console provider contracts and durable session outputs (mock transport, not live generation)",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Exercise real persistence and adapters against deterministic provider responses",
    async run(ctx) {
      let result;
      await ctx.prove("Provider mapping, credential filtering, retry safety and session-owned files pass executable checks", {
        voiceover: "这里验证视频控制台的接口映射和后台任务。测试使用模拟的服务商响应，真实写入临时数据库与文件，不代表已通过在线生视频或界面验收。",
        action: async () => {
          result = spawnSync("bun", ["test", "apps/server/src/extensions/video-generation.test.ts", "apps/server/src/extensions/storage.test.ts", "apps/server/src/plugin-package-manifest.test.ts", "apps/server/src/limited-request-body.test.ts"], {
            cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", timeout: 55000, windowsHide: true,
          });
          ctx.output("Backend and inspector contract tests", `${result.stdout}\n${result.stderr}`);
        },
        assert: async () => {
          ctx.assert(result.status === 0, "All focused executable checks pass");
          ctx.assert(/0 fail/.test(result.stderr + result.stdout), "Test runner reports no failed assertions");
        },
      });
    },
  }],
};
