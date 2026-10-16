export default {
  id: "composer-stop-confirmation",
  title: "暂停后的迟到消息确认不会产生重复对话（隔离传输）",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "composer-stop-confirmation-proof.html" },
  steps: [{ name: "连续发送并暂停", async run(ctx) {
    await ctx.waitForText("暂停消息确认回归验证");
    await ctx.prove("连续三次发送并暂停后，迟到确认与重复回放均只保留三条用户消息", {
      voiceover: "连续三次发送相同内容并暂停，服务端的迟到确认不会再生成重复对话。",
      action: async () => {
        for (let turn = 1; turn <= 3; turn++) {
          await ctx.fill('[contenteditable="true"][data-lexical-editor="true"]', "当前是什么模型");
          await ctx.trustedClick('button[aria-label="运行任务"]');
          await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="停止"]\'))');
          await ctx.trustedClick('button[aria-label="停止"]');
          await ctx.waitForText(`服务端确认 ${turn} 条`);
        }
        await ctx.clickText("回放服务端确认");
      },
      assert: async () => {
        await ctx.expectText("发送 3 次 · 暂停 3 次 · 服务端确认 3 条 · 显示 3 条");
        ctx.assert(await ctx.eval('document.querySelectorAll(\'[data-message-role="user"]\').length') === 3, "one user row per send");
      },
      screenshot: { name: "three-stopped-prompts", requireText: ["显示 3 条", "当前是什么模型"] },
    });
  } }],
};
