export default {
  id: "wechat-detail-authorization",
  title: "公众号详情页统一引导到运营台管理账号",
  kind: "user-facing",
  steps: [{
    name: "公众号详情页没有重复授权或撤销入口",
    run: async (ctx) => {
      await ctx.prove("公众号详情页引导用户在运营台管理多个账号", {
        voiceover: "公众号账号统一在运营台内管理，插件详情页不再要求重复配置授权。",
        action: async () => {
          await ctx.navigateHash("/settings/extensions/plugin/wechat-official");
          await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="plugin-workbench-accounts-hint"]\'))', {
            timeoutMs: 15000, label: "workbench account management hint",
          });
          await ctx.eval('document.querySelector(\'[data-testid="plugin-workbench-accounts-hint"]\').scrollIntoView({block:"center"})');
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
