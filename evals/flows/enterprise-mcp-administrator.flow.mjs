export default {
  id: "enterprise-mcp-administrator",
  title: "MCP 管理员在 Work 发布企业工具",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "enterprise-collaboration-proof.html?mcp-admin" },
  steps: [{
    name: "管理员发布，员工只查看获授权工具",
    async run(ctx) {
      await ctx.prove("MCP 管理员发布工具", {
        voiceover: "在企业目录点发布 MCP，填写名称和服务地址。保存后可在同一张卡片上为成员分配权限。",
        action: async () => {
          await ctx.clickText("发布 MCP");
          await ctx.fill("#enterprise-mcp-name", "企业知识库");
          await ctx.fill("#enterprise-mcp-url", "https://tools-proof.invalid/mcp");
          await ctx.clickText("发布 MCP", { selector: '[role="dialog"] button[type="submit"]' });
        },
        assert: () => ctx.expectText("企业知识库"),
        screenshot: { name: "mcp-admin", requireText: ["企业知识库", "编辑 MCP", "分配权限", "下架"] },
      });
      await ctx.prove("普通员工只看自己的目录", {
        voiceover: "切换到普通成员后，发布和编辑入口隐藏。没有获得授权的工具也不会出现在列表里。",
        action: () => ctx.clickText("切换到普通成员"),
        assert: async () => {
          await ctx.expectText("暂无可用的企业 MCP");
          await ctx.expectNoText("发布 MCP");
        },
        screenshot: { name: "mcp-employee", requireText: ["暂无可用的企业 MCP"], rejectText: ["发布 MCP", "企业知识库"] },
      });
    },
  }],
};
