async function settle(ctx) {
  await ctx.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', { awaitPromise: true });
}

export default {
  id: "release-main-surfaces",
  title: "Packaged desktop template, schedule and extension surfaces",
  kind: "user-facing",
  steps: [
    {
      name: "Browse bundled templates",
      run: async (ctx) => {
        await ctx.prove("Bundled templates display their catalog, categories and real covers", {
          voiceover: "打开模板库，可以查看网站、视频、幻灯片和 App 模板，封面也正常加载。",
          action: async () => {
            await ctx.client.send("Page.bringToFront");
            const workspaceId = await ctx.eval("location.hash.split('/')[2]");
            await ctx.navigateHash("/workspace/" + workspaceId + "/session");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-project-button]'))");
            await ctx.clickText("模板", { selector: "[data-sidebar=menu-button]" });
          },
          assert: async () => {
            await ctx.waitFor("[...document.querySelectorAll('[role=dialog][data-open] img')].filter(image => image.complete && image.naturalWidth > 0).length >= 4");
            for (const text of ["网站", "视频", "幻灯片", "App 原型", "导入", "使用"]) await ctx.expectText(text);
            await settle(ctx);
          },
          screenshot: { name: "bundled-template-catalog", requireText: ["Calm Mobile App", "网站", "视频"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Switch schedule views",
      run: async (ctx) => {
        await ctx.prove("The schedule loads completed tasks and switches from week to month", {
          voiceover: "日程汇总项目任务，周视图和月视图可以正常切换，并保留本地时区。",
          action: async () => {
            await ctx.eval("document.querySelector('[role=dialog][data-open] [data-slot=dialog-close]').click()");
            await ctx.waitFor("!document.querySelector('[role=dialog][data-open]')");
            await ctx.clickText("日程", { selector: "[data-sidebar=menu-button]" });
            await ctx.waitFor("document.body.innerText.includes('06:00') && document.body.innerText.includes('Asia/Shanghai')");
            await ctx.eval("[...document.querySelectorAll('button')].find(button => button.innerText.trim() === '月').click()");
          },
          assert: async () => {
            await ctx.waitFor("document.body.innerText.includes('周一') && !document.body.innerText.includes('06:00')");
            await ctx.expectText("新建日程");
            await ctx.expectText("已完成");
            await settle(ctx);
          },
          screenshot: { name: "monthly-schedule", requireText: ["新建日程", "周一", "周日", "Asia/Shanghai"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Browse installed extensions",
      run: async (ctx) => {
        await ctx.prove("The extensions page lists the installed annotation plugin", {
          voiceover: "扩展页面正常列出已安装的插件，数据标注与其他内置能力一起保留。",
          action: async () => {
            await ctx.clickText("扩展", { selector: "[data-sidebar=menu-button]" });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=plugin-installed-row]'))");
            if (!(await ctx.eval("Boolean(document.querySelector('[data-testid=plugin-installed-tile][aria-label*=数据标注]'))"))) {
              await ctx.trustedClick("[data-testid=plugin-installed-expand]");
            }
          },
          assert: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=plugin-installed-tile][aria-label*=数据标注]'))");
            await ctx.expectText("已安装");
            await ctx.expectText("技能");
            await settle(ctx);
          },
          screenshot: { name: "installed-extensions", requireText: ["数据标注", "已安装", "技能"], rejectText: ["Unexpected server error"] },
        });
      },
    },
  ],
};
