// Open an accepted Enterprise summary session before running. Uses the real
// account and local session. The second frame sends one short test prompt using
// an already connected GPT-5.6 Luna account; it does not change remote resources.
export default {
  id: "enterprise-session-restore",
  title: "刷新后保留企业身份与已接收的会话",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "/#/workspace/" },
  steps: [{ name: "企业会话冷启动恢复", async run(ctx) {
    const before = await ctx.eval(`({
      context: localStorage.getItem('ipollowork.work-context.v1'),
      route: location.hash,
      hasSnapshot: Boolean(document.querySelector('[data-testid=enterprise-snapshot-context]'))
    })`);
    ctx.assert(before.context?.startsWith("enterprise:") && before.hasSnapshot, "Start in an accepted Enterprise summary session");
    await ctx.prove("刷新后企业身份、会话地址和本机总结同时保留", {
      voiceover: "刷新客户端后仍处于原企业，已接收的总结保留在同一个会话中，账号验证后企业连接恢复可用。",
      action: async () => {
        await ctx.client.send("Page.reload");
        await ctx.waitFor(`Boolean(document.querySelector('[data-testid=enterprise-snapshot-context] summary'))`, { timeoutMs: 60000 });
        await ctx.waitFor(`(async () => {
          const connections = await import('/src/app/lib/enterprise-connections.ts');
          const context = await import('/src/app/lib/work-context.ts');
          return connections.hasVerifiedEnterpriseConnectionAccount() && Boolean(context.readActiveEnterpriseConnection());
        })()`, { timeoutMs: 60000 });
        await ctx.trustedClick('[data-testid="enterprise-snapshot-context"] summary');
      },
      assert: async () => {
        ctx.assert(await ctx.eval(`localStorage.getItem('ipollowork.work-context.v1') === ${JSON.stringify(before.context)}`), "Enterprise selection survived authentication startup");
        ctx.assert(await ctx.eval(`location.hash === ${JSON.stringify(before.route)}`), "Original session route survived reload");
        ctx.assert(await ctx.eval(`document.querySelector('[data-testid=enterprise-snapshot-context]').innerText.length > 50`), "Persisted summary is visible without another model request");
      },
      screenshot: { name: "enterprise-session-restored", requireText: ["总结快照"] },
    });
  } }, { name: "首次续聊消息不重复", async run(ctx) {
    const reply = `mvp-share-echo-${Date.now()}`;
    const before = await ctx.eval('document.querySelectorAll("[data-testid=user-message-bubble]").length');
    await ctx.prove("附加总结后只有一条用户提问，模型可以正常回复", {
      voiceover: "选择已连接的模型继续提问。企业总结作为参考资料发送，界面保留一条提问和一条模型回复，没有重复的用户消息。",
      action: async () => {
        await ctx.trustedClick('[data-testid="enterprise-snapshot-context"] summary');
        await ctx.trustedClick('[data-testid="composer-model-trigger"]');
        await ctx.clickText("切换模型", { selector: '[role="dialog"] button' });
        await ctx.clickText("GPT-5.6 Luna视觉OpenAI", { selector: '[role="option"]' });
        await ctx.trustedClick('[role="textbox"][contenteditable="true"]');
        await ctx.client.send("Input.insertText", { text: `MVP 分享续聊去重验收：只回复 ${reply}，禁止调用工具。` });
        await ctx.trustedClick('button[title="运行任务"]');
        await ctx.waitFor(`Array.from(document.querySelectorAll('[data-message-role="assistant"]')).some(element => element.innerText.includes(${JSON.stringify(reply)}))`, { timeoutMs: 60000 });
      },
      assert: async () => {
        ctx.assert(await ctx.eval('document.querySelectorAll("[data-testid=user-message-bubble]").length') === before + 1, "One submission produces exactly one user message after the engine echo");
      },
      screenshot: { name: "enterprise-share-single-message", requireText: [reply] },
    });
  } }],
};
