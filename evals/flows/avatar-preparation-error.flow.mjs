const proofOrigin = process.env.IPOLLOWORK_AVATAR_PROOF_ORIGIN || "http://127.0.0.1:5173";

export default {
  id: "avatar-preparation-error",
  title: "数字人提交失败直接显示错误",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "127.0.0.1:5173" },
  preserveTheme: true,
  steps: [{
    name: "Show the provider workflow error instead of waiting",
    run: async (ctx) => {
      const originalUrl = await ctx.eval("location.href");
      await ctx.client.send("Page.navigate", { url: `${proofOrigin}/tests/video-avatar-proof.html?panel=avatar&prepareFail` });
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=avatar-job-card]'))");
      await ctx.prove("A preparation failure is visible in both history and task details", {
        voiceover: "数字人没有提交成功时，生成记录和详情直接说明工作流错误，不再显示正在准备生成。",
        action: async () => {
          await ctx.trustedClick("[data-testid=avatar-job-card]");
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=avatar-task-dialog]'))");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({
            card: document.querySelector('[data-testid=avatar-job-card]')?.innerText || '',
            dialog: document.querySelector('[data-testid=avatar-task-dialog]')?.innerText || '',
            progress: Boolean(document.querySelector('[data-testid=avatar-task-dialog] [aria-label="数字人生成进度"]'))
          }))()`);
          const error = "数字人工作流节点已变化，尚未提交生成。";
          ctx.assert(state.card.includes(error) && state.dialog.includes(error), JSON.stringify(state));
          ctx.assert(!state.card.includes("正在准备生成") && !state.dialog.includes("正在准备生成") && !state.progress, JSON.stringify(state));
        },
        screenshot: { name: "avatar-preparation-error", requireText: ["需要处理", "尚未提交生成"], rejectText: ["正在准备生成"] },
      });
      await ctx.client.send("Page.navigate", { url: originalUrl });
    },
  }],
};
