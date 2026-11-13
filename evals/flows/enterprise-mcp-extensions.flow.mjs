export default {
  id: "enterprise-mcp-extensions",
  title: "在扩展中安装企业 MCP",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html?mcp" },
  steps: [{
    name: "安装和卸载企业 MCP",
    async run(ctx) {
      await ctx.waitForText("企业知识库");
      await ctx.prove("员工从扩展安装企业发布的 MCP", {
        voiceover: "打开扩展里的 MCP，找到企业知识库，点击安装。工具就出现在已连接的列表中。",
        action: () => ctx.trustedClick('[data-testid="enterprise-mcp-card"] [data-slot="card-footer"] button'),
        assert: async () => {
          await ctx.waitForText("已连接");
          await ctx.waitFor(`document.querySelector('[data-testid="proof-mcp-install"]')?.dataset.authorizedReads === "1"`);
          await ctx.expectNoText("团队 Connect");
        },
        screenshot: { name: "installed", requireText: ["企业知识库", "已连接", "卸载"], rejectText: ["团队 Connect"] },
      });
      await ctx.prove("卸载后可以重新安装", {
        voiceover: "在同一页点卸载。需要再用时，可以从目录重新安装。",
        action: () => ctx.clickText("卸载", { selector: '[data-testid="enterprise-mcp-card"] button' }),
        assert: async () => {
          await ctx.waitFor(`!document.querySelector('[data-testid="proof-mcp-install"]')?.dataset.installed`);
          await ctx.expectText("安装");
        },
        screenshot: { name: "uninstalled", requireText: ["企业知识库", "安装"], rejectText: ["已连接", "卸载"] },
      });
      await ctx.prove("安装前重新确认员工权限", {
        voiceover: "如果权限在打开目录后被收回，点击安装会收到提示，工具不会添加到当前空间。",
        action: async () => {
          await ctx.eval(`document.querySelector('[data-testid="proof-mcp-revoke"]').click()`);
          await ctx.clickText("安装", { selector: '[data-testid="enterprise-mcp-card"] button' });
        },
        assert: async () => {
          await ctx.waitForText("无法安装或连接此 MCP");
          await ctx.waitFor(`!document.querySelector('[data-testid="proof-mcp-install"]')?.dataset.installed`);
        },
        screenshot: { name: "permission-removed", requireText: ["无法安装或连接此 MCP"], rejectText: ["已连接"] },
      });
    },
  }],
};
