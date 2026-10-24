const share = '[data-testid="enterprise-session-share"]';

export default {
  id: "enterprise-summary-preview",
  title: "总结生成：模型错误提示与预览重试",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [{ name: "生成总结并预览", async run(ctx) {
    if (await ctx.eval(`Boolean(document.querySelector('${share}'))`)) await ctx.trustedClick(`${share} [data-slot="dialog-close"]`);
    await ctx.trustedClick('[data-testid="proof-fail-summary"]');
    await ctx.trustedClick('[data-testid="proof-share"]');
    await ctx.trustedClick(`${share} [role="checkbox"][aria-label="选择部门 星河科技"]`);
    await ctx.waitForText("已选 3 人");
    if (await ctx.eval(`document.querySelector('${share} > label [role="checkbox"]').getAttribute('aria-checked') !== 'true'`)) await ctx.trustedClick(`${share} > label [role="checkbox"]`);
    await ctx.prove("总结失败显示具体模型原因，保留收件人并允许重试", {
      voiceover: "模型额度不足时显示模型的具体原因，收件人和预览选项都保留，可以重试。",
      action: async () => { await ctx.clickText("生成总结并预览"); },
      assert: async () => {
        await ctx.expectText("第三方服务余额或额度不足");
        await ctx.expectText("已选 3 人");
        await ctx.expectNoText("企业服务请求失败");
      },
      screenshot: { name: "model-summary-error", requireText: ["第三方服务余额或额度不足", "已选 3 人"], rejectText: ["企业服务请求失败"] },
    });
    await ctx.prove("重试成功后可以预览编辑 Markdown 总结，尚未发送分享", {
      voiceover: "重试成功后出现总结标题和 Markdown 正文，确认发送前不会把内容分享给员工。",
      action: async () => { await ctx.clickText("生成总结并预览"); await ctx.waitForText("Markdown 总结"); await ctx.trustedClick(`${share} [data-slot="dialog-footer"]`); },
      assert: async () => {
        ctx.assert(await ctx.eval(`document.querySelector('${share} textarea').value.includes('关键结论')`), "Markdown preview contains summary text");
        await ctx.expectText("确认发送");
        await ctx.expectNoText("第三方服务余额或额度不足");
        ctx.assert(await ctx.eval('document.querySelector(\'[data-testid="proof-result"]\').textContent.includes("分享次数 0")'), "preview does not send a share");
      },
      screenshot: { name: "summary-preview-success", requireText: ["Markdown 总结", "确认发送"] },
    });
  } }],
};
