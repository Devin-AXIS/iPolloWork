import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

async function verify(ctx, claim, voiceover, packagePath, args) {
  await ctx.prove(claim, {
    voiceover,
    assert: async () => {
      const { stdout, stderr } = await exec("bun", args, {
        cwd: fileURLToPath(new URL(packagePath, import.meta.url)),
        timeout: 60_000,
      });
      const output = stdout + stderr;
      ctx.output(claim, output);
      ctx.assert(/\b0 fail\b/.test(output) || /Test Files\s+1 passed/.test(output),
        "The scoped test must pass without scanning sibling worktrees");
    },
  });
}

export default {
  id: "video-merge-invariants",
  title: "Merged video workflow preserves automatic production and durable review",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Check merged production boundaries without external publication",
    async run(ctx) {
      await verify(ctx, "Normal video requests continue automatically while explicit script review pauses",
        "普通成片请求会继续制作；只有明确要求先审脚本时才暂停。这里验证会话契约，不调用模型或发布平台。",
        "../../apps/app/", ["test", "tests/video-hyperframes-panel.test.ts", "-t", "continues finished videos by default"]);
      await verify(ctx, "Script and music edits preserve narration without preloading synthesis guidance",
        "只写脚本、改配乐或颜色时，已有旁白只需保留；进入实际配音或字幕阶段才读取对应规则。这里检查应用生成的任务契约，不代表模型创作品质验收。",
        "../../apps/app/", ["test", "tests/video-hyperframes-panel.test.ts", "-t", "loads narration and caption guidance only"]);
      await verify(ctx, "Three engine projections upgrade old video skills while preserving user artifacts",
        "临时服务器分别验证 OpenCode、Codex 和 DeepSeek 的旧版升级，五个入口和参考文件完整投影，用户视频、账号和个人技能保持原样。",
        "../../apps/server/", ["test", "src/plugin-package-lifecycle.test.ts", "-t", "upgrades bundled Video rules"]);
      await verify(ctx, "Rendered delivery rejects stale source and failed runtime evidence",
        "导出回执不能掩盖源文件变更或运行时验收失败。这是隔离的本地渲染测试，不代表平台实发。",
        "../../apps/server/", ["test", "src/extensions/video-render.test.ts", "-t", "runtime acceptance failures"]);
      await verify(ctx, "Studio saves edited script before requesting regenerated production",
        "用户在右栏修改分镜后，先保存脚本再请求继续制作；任务状态与文件内容仍由当前会话管理。",
        "../../vendor/hyperframes/packages/studio/", ["run", "test", "--", "src/components/storyboard/StoryboardTable.test.tsx", "-t", "saves edits and asks"]);
    },
  }],
};
