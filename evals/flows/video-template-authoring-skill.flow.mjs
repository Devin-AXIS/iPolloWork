export default {
  id: "video-template-authoring-skill",
  title: "My templates exposes the typed authoring entry",
  kind: "user-facing",
  steps: [
    {
      name: "Create template stays discoverable in My templates",
      run: async (ctx) => {
        await ctx.prove("A local user can open My templates and choose Video from the typed template creator", {
          action: async () => {
            await ctx.eval("localStorage.setItem('ipollowork.language', 'zh'); location.reload()");
            await ctx.waitFor("Boolean(window.__ipolloworkControl) && document.body.innerText.includes('模版')", {
              timeoutMs: 60_000,
              label: "Chinese workspace sidebar",
            });
            await ctx.clickText("模版", { selector: "button", timeoutMs: 30_000 });
            await ctx.clickText("我的模板", { selector: "button", timeoutMs: 30_000 });
            await ctx.clickText("创建模板", { selector: "button", timeoutMs: 30_000 });
            await new Promise((resolve) => setTimeout(resolve, 1_500));
          },
          assert: async () => {
            await ctx.expectText("创建哪种模板？");
            for (const label of ["网站", "演示文稿", "原生可编辑 PPT", "视频", "App 原型", "海报", "信息卡片", "数据报告", "杂志文章", "其他"]) {
              await ctx.expectText(label);
            }
            const choices = await ctx.eval("document.querySelectorAll('[role=dialog] button[class*=\"min-h-20\"]').length");
            ctx.assert(choices === 10, `Expected ten authoring types, got ${choices}.`);
          },
          screenshot: {
            name: "my-templates-video-authoring",
            fromSurface: false,
            requireText: ["创建哪种模板？", "视频", "原生可编辑 PPT"],
          },
        });
      },
    },
  ],
};
