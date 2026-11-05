const picker = '[data-testid="enterprise-people-picker"]';

export default {
  id: "enterprise-people-picker-empty",
  title: "企业选人：空部门不展开",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html" },
  steps: [{ name: "空部门与有人员部门", async run(ctx) {
    if (await ctx.eval("Boolean(document.querySelector('[data-testid=\"enterprise-session-share\"]'))")) {
      await ctx.trustedClick('[data-testid="enterprise-session-share"] [data-slot="dialog-close"]');
    }
    await ctx.trustedClick('[data-testid="proof-share"]');
    await ctx.prove("空部门没有展开箭头和空提示，有人员的部门仍可展开选择", {
      voiceover: "空部门不再展开空白区域，也不显示暂无人员提示；有子部门或人员的节点仍然可以正常展开和选择。",
      action: async () => {
        await ctx.trustedClick(`${picker} button[aria-label="展开星河科技"]`);
        await ctx.trustedClick(`${picker} button[aria-label="展开空部门"]`);
        await ctx.waitFor(`!document.querySelector('${picker} [role="status"]')`);
        ctx.assert(!await ctx.eval(`Boolean(document.querySelector('${picker} button[aria-label="展开空部门"], ${picker} button[aria-label="收起空部门"]'))`), "empty department has no disclosure button");
        await ctx.trustedClick(`${picker} button[aria-label="展开研发部"]`);
        await ctx.waitForText("wanglei@example.com");
        await ctx.trustedClick(`${picker} [role="checkbox"][aria-label="选择 王磊"]`);
      },
      assert: async () => {
        await ctx.expectText("已选 1 人");
        await ctx.expectText("空部门");
        await ctx.expectNoText("该部门暂无可选人员");
        ctx.assert(await ctx.eval(`document.querySelector('${picker} button[aria-label="收起星河科技"]').getAttribute('aria-expanded') === 'true' && document.querySelector('${picker} button[aria-label="收起研发部"]').getAttribute('aria-expanded') === 'true'`), "parents and member-bearing departments remain expandable");
      },
      screenshot: { name: "empty-department-leaf", requireText: ["空部门", "王磊", "已选 1 人"], rejectText: ["该部门暂无可选人员"] },
    });
  } }],
};
