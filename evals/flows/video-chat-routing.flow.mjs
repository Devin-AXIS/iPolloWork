import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default {
  id: "video-chat-routing",
  title: "Video chat routing contracts (deterministic tests, not live UI or generation)",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Check composition, footage, mixed requests and engine instructions",
    async run(ctx) {
      await ctx.prove("Executable routing fixtures distinguish HTML compositions from explicit footage requests", {
        voiceover: "这里验证对话路由规则：生成视频默认创建可编辑的视频项目，明确的插件或素材请求走素材路径，素材再合成成片的请求保留视频项目。这些是确定性测试，不代表真实界面或在线生成已经验收。",
        action: async () => {
          for (const [directory, files] of [
            ["apps/app/", ["tests/template-brief.test.ts", "tests/video-artifact-entry.test.ts", "tests/video-hyperframes-panel.test.ts"]],
            ["apps/server/", ["src/opencode-plugins/ipollowork-extensions-preview.test.ts"]],
          ]) {
            const result = spawnSync("bun", ["test", ...files], {
              cwd: fileURLToPath(new URL(`../../${directory}`, import.meta.url)),
              encoding: "utf8", timeout: 55_000, windowsHide: true,
            });
            const output = `${result.stdout}\n${result.stderr}`;
            ctx.output(directory, output);
            ctx.assert(result.status === 0 && /0 fail/.test(output), `${directory}: routing contract checks pass`);
          }
        },
      });
    },
  }],
};
