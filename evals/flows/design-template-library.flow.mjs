async function clickText(ctx, text) {
  const clicked = await ctx.eval(`(() => {
    const target = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes(${JSON.stringify(text)}) && !button.disabled);
    target?.click();
    return Boolean(target);
  })()`);
  ctx.assert(clicked, `Button ${text} was not available.`);
}

async function ensureDesignSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, { timeoutMs: 30_000, label: "create task action" });
  await ctx.control("session.create_task");
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes("/session/")`, { timeoutMs: 60_000, label: "created task" });
  const sessionId = await ctx.eval(`(() => window.__ipolloworkControl.snapshot().route.split('/session/')[1]?.split(/[/?#]/)[0] || '')()`);
  ctx.assert(sessionId, "The created task did not expose a session id.");
  await ctx.eval(`localStorage.setItem(${JSON.stringify("ipollowork.session-type.")} + ${JSON.stringify(sessionId)}, "design")`);
  await ctx.client.send("Page.reload", { ignoreCache: true });
  await ctx.waitFor(`document.body.innerText.includes("开始设计")`, { timeoutMs: 60_000, label: "Design template entry" });
}

export default {
  id: "design-template-library",
  title: "Installable Design templates stay lightweight inside new Design tasks",
  kind: "user-facing",
  steps: [
    {
      name: "The server-backed catalog keeps the category-first entry",
      run: async (ctx) => {
        await ctx.prove("A new Design task starts with three quiet categories instead of a separate marketplace page", {
          action: async () => { await ensureDesignSession(ctx); },
          assert: async () => {
            await ctx.expectText("网站");
            await ctx.expectText("幻灯片");
            await ctx.expectText("宣传海报");
            const state = await ctx.eval(`(() => ({ marketplace: document.body.innerText.includes('模板市场'), categories: ['网站','幻灯片','宣传海报'].every((text) => document.body.innerText.includes(text)) }))()`);
            ctx.assert(state.categories && !state.marketplace, `Unexpected template entry: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "template-categories", requireText: ["开始设计", "网站", "幻灯片", "宣传海报"] },
        });
      },
    },
    {
      name: "Bundled template metadata and cover come from the Server catalog",
      run: async (ctx) => {
        await ctx.prove("Website templates show a real cover, source and installed action from the workspace catalog", {
          action: async () => {
            await clickText(ctx, "网站");
            await ctx.waitForText("SaaS Landing", { timeoutMs: 30_000 });
            await ctx.waitFor(`Boolean([...document.querySelectorAll('article img')].find((image) => image.complete && image.naturalWidth > 0))`, { timeoutMs: 10_000, label: "template cover" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({ cover: Boolean([...document.querySelectorAll('img')].find((image) => image.closest('article'))), source: document.body.innerText.includes('Open Design'), action: [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('使用模板')) }))()`);
            ctx.assert(state.cover && state.source && state.action, `Template card is incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "server-template-card", requireText: ["SaaS Landing", "使用模板", "Open Design", "导入 .ipwt"] },
        });
      },
    },
    {
      name: "Using a template materializes the session snapshot",
      run: async (ctx) => {
        await ctx.prove("Using the installed template moves directly into its session-specific Design brief", {
          action: async () => { await clickText(ctx, "使用模板"); await ctx.waitForText("告诉我你要做什么", { timeoutMs: 30_000 }); },
          assert: async () => {
            const state = await ctx.eval(`(() => ({ brief: document.body.innerText.includes('Design brief'), name: Boolean(document.querySelector('input[placeholder*="iPollo Studio"]')), purpose: Boolean(document.querySelector('input[placeholder*="创意工作"]')), colors: document.querySelectorAll('input[type="color"]').length }))()`);
            ctx.assert(state.brief && state.name && state.purpose && state.colors === 1, `Design brief did not open: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "materialized-design-brief", requireText: ["SaaS Landing", "Design brief", "主题色", "生成我的网站"] },
        });
      },
    },
  ],
};
