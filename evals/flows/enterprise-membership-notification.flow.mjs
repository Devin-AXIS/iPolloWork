export default {
  id: "enterprise-membership-notification",
  title: "企业成员变更通知",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html?notifications&membership" },
  steps: [{
    name: "角色、部门和成员资格变更",
    async run(ctx) {
      await ctx.waitForText("统一通知清除验证");
      await ctx.prove("通知逐项显示原角色、原部门和变更后的值", {
        voiceover: "打开通知，可以直接看到角色和部门分别从什么改成了什么。",
        action: async () => {
          await ctx.trustedClick('[data-testid="notification-proof-reset"]');
          await ctx.trustedClick('[data-testid="notification-proof-change-details"]');
          await ctx.waitFor(`Object.values(localStorage).some(value => value.includes("部门：产品部 → 研发部"))`);
          await ctx.trustedClick('[data-testid="notification-center-trigger"]');
        },
        assert: async () => {
          await ctx.expectText("星河科技 成员信息已更新");
          await ctx.expectText("角色：所有者 → 技能管理员");
          await ctx.expectText("部门：产品部 → 研发部");
        },
        screenshot: { name: "role-and-department", requireText: ["成员信息已更新", "角色：所有者 → 技能管理员", "部门：产品部 → 研发部"] },
      });
      await ctx.prove("取消部门分配时显示未分配", {
        voiceover: "如果成员被移出部门，通知会显示原部门和现在的未分配状态。",
        action: async () => {
          await ctx.trustedClick('[data-testid="notification-center-trigger"]');
          await ctx.trustedClick('[data-testid="notification-proof-remove-department"]');
          await ctx.waitFor(`Object.values(localStorage).some(value => value.includes("部门：研发部 → 未分配"))`);
          await ctx.trustedClick('[data-testid="notification-center-trigger"]');
        },
        assert: async () => { await ctx.expectText("部门：研发部 → 未分配"); },
        screenshot: { name: "department-unassigned", requireText: ["部门：研发部 → 未分配"] },
      });
      await ctx.prove("切回个人空间后，通知中心显示企业停用提醒", {
        voiceover: "切回个人空间后，如果企业管理员停用你的成员资格，通知中心会显示企业名称和停用原因。",
        action: async () => {
          await ctx.trustedClick('[data-testid="notification-center-trigger"]');
          await ctx.trustedClick('[data-testid="notification-proof-reset"]');
          await ctx.clickText("模拟管理员停用成员");
          await ctx.waitFor(`Object.values(localStorage).some(value => value.includes("你的企业成员资格已停用"))`);
          await ctx.trustedClick('[data-testid="notification-center-trigger"]');
        },
        assert: async () => {
          await ctx.waitForText("星河科技 成员状态有变更");
          await ctx.expectText("你的企业成员资格已停用，请联系管理员。");
          ctx.assert(await ctx.eval(`localStorage.getItem("ipollowork.work-context.v1") === "personal"`), "The member is still in their personal workspace");
        },
        screenshot: { name: "enterprise-membership-suspended", requireText: ["星河科技 成员状态有变更", "你的企业成员资格已停用，请联系管理员。"] },
      });
    },
  }],
};
