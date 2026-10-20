// Production receive/reopen controls; synthetic transport only in the isolated fixture.
const stats = (ctx) => ctx.eval('document.querySelector(\'[data-testid="proof-result"]\').innerText');
const openMessage = async (ctx) => {
  await ctx.trustedClick('[data-testid="enterprise-inbox"] button:has-text("产品方案讨论总结")');
  await ctx.waitForText("接收并新建会话");
  await ctx.clickText("接收并新建会话");
};

export default {
  id: "enterprise-share-consumption",
  title: "本机保存成功后才确认领取并清理企业总结",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [
    { name: "本机保存失败", async run(ctx) {
      await ctx.prove("本机保存失败时，不发送接收确认，不清除企业正文", {
        voiceover: "本机保存失败时，企业端仍保留待领取的总结，员工可以重试接收。",
        action: async () => { await ctx.trustedClick('[data-testid="proof-fail-import"]'); await openMessage(ctx); await ctx.waitForText("操作未完成，请稍后重试。"); },
        assert: async () => {
          const value = await stats(ctx);
          ctx.assert(value.includes("本机创建次数 0") && value.includes("企业正文 待领取") && value.includes("接收回执次数 0"), "failed persistence never acknowledges or clears the share");
        },
        screenshot: { name: "local-save-failure", requireText: ["操作未完成，请稍后重试。"] },
      });
      await ctx.trustedClick('[data-slot="dialog-content"][data-open] [data-slot="dialog-close"]');
    } },
    { name: "接收回执失败", async run(ctx) {
      await ctx.prove("回执失败仍保留本机会话和企业待领取正文", {
        voiceover: "本机会话已保存，但接收回执暂时失败。企业端保留正文，重试会复用已有会话。",
        action: async () => { await ctx.trustedClick('[data-testid="proof-fail-accept"]'); await openMessage(ctx); await ctx.waitForText("产品方案讨论 · 独立会话"); },
        assert: async () => {
          const value = await stats(ctx);
          ctx.assert(value.includes("本机创建次数 1") && value.includes("企业正文 待领取") && value.includes("接收回执次数 1"), "local copy survives a failed acknowledgement");
        },
        screenshot: { name: "acknowledgement-failure", requireText: ["独立会话", "本机创建次数 1", "企业正文 待领取"] },
      });
    } },
    { name: "确认后清理与再次打开", async run(ctx) {
      await ctx.prove("接收确认后企业正文清理，本机总结仍可打开且只创建一次", {
        voiceover: "接收确认后企业端清理总结正文，消息保留已接收状态。再次打开使用本机副本，不重复创建会话。",
        action: async () => {
          await openMessage(ctx);
          await ctx.waitForText("企业正文 已清理");
          await ctx.trustedClick('[data-testid="enterprise-inbox"] button:has-text("产品方案讨论总结")');
          await ctx.waitForText("企业端不再向你提供正文");
          await ctx.clickText("在本机打开分享会话");
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="enterprise-snapshot-context"] summary\'))');
          await ctx.trustedClick('[data-testid="enterprise-snapshot-context"] summary');
          await ctx.trustedClick('[data-testid="proof-result"]');
        },
        assert: async () => {
          const value = await stats(ctx);
          ctx.assert(value.includes("本机创建次数 1") && value.includes("企业正文 已清理") && value.includes("接收回执次数 2"), "retries and reopening use one local copy after remote cleanup");
          await ctx.expectText("当前路由 /workspace/project-proof/session/imported-session");
          await ctx.expectText("关键结论");
        },
        screenshot: { name: "received-body-cleared", requireText: ["关键结论", "本机创建次数 1", "企业正文 已清理", "接收回执次数 2"] },
      });
    } },
    { name: "设置页接收与项目就绪", async run(ctx) {
      await ctx.trustedClick('[data-testid="proof-reset-received"]');
      await ctx.trustedClick('[data-testid="proof-settings"]');
      await ctx.waitForText("当前路由 /settings/extensions");
      await ctx.prove("从设置页接收时等待本机项目就绪，成功后打开新会话", {
        voiceover: "在设置页收到分享时，先进入会话页并等待项目连接，接收完成后再打开新的独立会话。",
        action: async () => {
          await openMessage(ctx);
          await ctx.waitForText("当前路由 /workspace/project-proof/session/imported-session");
          await ctx.waitForText("产品方案讨论 · 独立会话");
          await ctx.trustedClick('[data-testid="proof-result"]');
        },
        assert: async () => {
          const value = await stats(ctx);
          ctx.assert(value.includes("本机创建次数 1") && value.includes("接收回执次数 1") && value.includes("企业正文 已清理"), "settings handoff waits for the workspace and completes once");
        },
        screenshot: { name: "settings-receive-routed", requireText: ["独立会话", "本机创建次数 1", "企业正文 已清理"] },
      });
    } },
    { name: "未继续提问也保留会话记录", async run(ctx) {
      await ctx.prove("导入总结无需再次提问就出现在会话记录，刷新和恢复启动缓存后仍显示", {
        voiceover: "刚接收的总结已经是有效会话。还没继续提问，也会保留在项目记录中，刷新后仍能找到。",
        action: async () => {
          await ctx.trustedClick('[data-testid="proof-refresh-sessions"]');
          await ctx.waitFor('document.querySelectorAll(\'[data-testid="proof-session-row"]\').length === 1');
          await ctx.trustedClick('[data-testid="proof-restore-cache"]');
          await ctx.trustedClick('[data-testid="proof-session-history"]');
        },
        assert: async () => {
          ctx.assert(await ctx.eval('document.querySelectorAll(\'[data-testid="proof-session-row"]\').length === 1 && document.querySelector(\'[data-testid="proof-session-row"]\').innerText === "产品方案讨论总结"'), "one imported conversation remains visible through native refresh and startup cache restoration");
        },
        screenshot: { name: "imported-history-visible", requireText: ["会话记录（生产列表过滤）", "从启动缓存恢复列表"] },
      });
    } },
  ],
};
