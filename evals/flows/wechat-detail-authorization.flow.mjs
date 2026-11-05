export default {
  id: "wechat-detail-authorization",
  title: "公众号详情页统一引导到运营台管理账号",
  kind: "user-facing",
  steps: [{
    name: "公众号列表显示打开而不是授权连接",
    run: async (ctx) => {
      await ctx.prove("公众号列表不再要求插件级授权", {
        voiceover: "公众号插件在列表中显示打开，账号授权统一在运营台内管理。",
        action: async () => {
          if (!await ctx.eval('location.hash.endsWith("/settings/extensions")')) await ctx.navigateHash("/settings/extensions");
          await ctx.waitFor('Array.from(document.querySelectorAll(\'[data-testid="plugin-package-list-item"]\')).some(row => row.innerText.includes("微信公众号"))', { timeoutMs: 15000 });
        },
        assert: async () => {
          const text = await ctx.waitFor('(() => { const text = Array.from(document.querySelectorAll(\'[data-testid="plugin-package-list-item"]\')).find(row => row.innerText.includes("微信公众号"))?.innerText; return text?.includes("打开") && !text.includes("授权连接") ? text : false; })()', { timeoutMs: 15000 });
          ctx.assert(text?.includes("打开") && !text.includes("授权连接"), "公众号列表按钮应为打开");
        },
        screenshot: { name: "wechat-list-open", requireText: ["微信公众号", "打开"], hashIncludes: "/settings/extensions" },
      });
    },
  }, {
    name: "公众号详情页没有重复授权或撤销入口",
    run: async (ctx) => {
      await ctx.prove("公众号详情页引导用户在运营台管理多个账号", {
        voiceover: "公众号账号统一在运营台内管理，插件详情页不再要求重复配置授权。",
        action: async () => {
          await ctx.navigateHash("/settings/extensions/plugin/wechat-official");
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="plugin-workbench-accounts-hint"]\'))', {
            timeoutMs: 15000, label: "workbench account management hint",
          });
          await ctx.eval('document.querySelector(\'[data-testid="plugin-workbench-accounts-hint"]\')?.scrollIntoView({block:"center"})');
        },
        assert: async () => {
          await ctx.expectText("在运营台管理账号");
          await ctx.expectText("已有账号与授权保持不变");
          await ctx.expectNoText("插件自己的授权");
          await ctx.expectNoText("配置授权");
          const revokeVisible = await ctx.eval('Array.from(document.querySelectorAll("button")).some(button => /撤销授权|Revoke/.test(button.innerText))');
          ctx.assert(!revokeVisible, "No single-account revoke button on the detail page");
        },
        screenshot: {
          name: "wechat-detail-account-management",
          requireText: ["在运营台管理账号", "已有账号与授权保持不变"],
          rejectText: ["插件自己的授权", "配置授权", "Something went wrong"],
          hashIncludes: "/settings/extensions/plugin/wechat-official",
        },
      });
    },
  }],
};
