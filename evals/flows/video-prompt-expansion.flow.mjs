// Uses image-selection-fixture.mjs --frames: production iframe and message bridge,
// with a simulated AI reply and video provider so verification never submits a paid job.
import { selectOption } from "./video-console.flow.mjs";

export default {
  id: "video-prompt-expansion",
  title: "会话扩写回填视频工作台",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5190" },
  steps: [{
    name: "扩写回填并提交一次模拟视频任务",
    run: async (ctx) => {
      await ctx.waitFor(`document.querySelector('iframe')?.contentDocument?.querySelector('#generateMode')`);
      await ctx.eval(`document.querySelector('iframe').contentDocument.querySelector('#generateMode').click()`);
      await ctx.eval(`document.querySelector('iframe').contentDocument.querySelector('#settings').click()`);
      await ctx.waitFor(`document.querySelector('[data-testid="workspace-app-inspector"]')?.innerText.includes('视频参数')`, { timeoutMs: 30_000 });
      await ctx.prove("扩写结果回填右侧描述，并自动提交一次生成任务", {
        voiceover: "生成前先由当前会话扩写，结果回填到右侧视频描述，然后自动提交一次任务。这里使用模拟 AI 和视频服务验证。",
        action: async () => {
          await selectOption(ctx, "视频模型", "MiniMax H3 · RunningHub 工作流");
          await selectOption(ctx, "生成方式", "文生视频");
          await ctx.fill('textarea[name="prompt"]', "夸父追日，国风水墨，五秒短片");
          await ctx.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '生成视频').click()`);
          await ctx.waitFor(`document.body.innerText.includes('当前会话收到扩写请求（模拟）')`);
          const before = await ctx.eval(`fetch('/witness').then(r => r.json())`, { awaitPromise: true });
          ctx.assert(before.videoJobs.length === 0, "Video was submitted before expansion.");
          await ctx.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('模拟 AI 回填并自动提交模拟视频')).click()`);
          await ctx.waitFor(`document.querySelector('textarea[name="prompt"]')?.value.includes('integrated_multimodal_description:')`);
          await ctx.waitFor(`document.body.innerText.includes('模拟视频任务已自动提交')`);
        },
        assert: async () => {
          const witness = await ctx.eval(`fetch('/witness').then(r => r.json())`, { awaitPromise: true });
          ctx.assert(witness.videoJobs.length === 1, "Expansion must submit exactly one video task.");
          ctx.assert(witness.videoJobs[0].prompt.includes('overall_soundscape:'), "The submitted task lost the expanded prompt.");
          ctx.assert(await ctx.eval(`!document.body.innerText.includes('扩写超时') && !document.querySelector('textarea[name="prompt"]').disabled`), "The inspector still shows an expansion failure or remains busy.");
        },
        screenshot: "expanded-prompt-submitted-once",
      });
    },
  }],
};
