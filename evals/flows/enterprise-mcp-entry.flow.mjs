const shortcut = '[data-testid="sidebar-navigation-shortcut-extensions"]';
const startup = '[data-testid="startup-logo-animation"]';
const workspaces = '[data-testid="workspace-options"] button[aria-pressed]';
const tabs = '[role="tablist"][aria-label="扩展类型"] [role="tab"]';
const sources = '[role="tablist"][aria-label="MCP 来源"] [role="tab"]';

export default {
  id: "enterprise-mcp-entry",
  title: "从左侧扩展进入企业 MCP",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5193" },
  requiredEnv: ["IPOLLOWORK_EVAL_ENTERPRISE_WORKSPACE"],
  steps: [{
    name: "个人、公开和企业 MCP 目录",
    async run(ctx) {
      const enterprise = ctx.env.IPOLLOWORK_EVAL_ENTERPRISE_WORKSPACE.trim();
      const currentProject = await ctx.eval(`location.hash.startsWith("#/workspace/") ? location.hash.slice(1).split("/").slice(0, 3).join("/") : ""`);
      await ctx.navigateHash(`${currentProject}/settings/cloud-account`);
      await ctx.clickText("个人聊天、会员及公共资源", { selector: workspaces });
      const openExtensions = async () => {
        await ctx.waitFor(`location.hash.includes("/session") && !document.querySelector(${JSON.stringify(startup)})`, { timeoutMs: 40000 });
        await ctx.clickText("扩展", { selector: shortcut });
      };
      await openExtensions();
      await ctx.clickText("技能", { selector: tabs });
      await ctx.prove("个人空间也能找到 MCP 标签", {
        voiceover: "从左侧打开扩展，再点 MCP。在个人空间，来源只显示个人和公开。",
        action: () => ctx.clickText("MCP", { selector: tabs }),
        assert: async () => {
          await ctx.waitForText("添加 MCP");
          await ctx.waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(sources)}), item => item.textContent.trim()).join(",") === "个人,公开"`);
        },
        screenshot: { name: "personal-mcp", requireText: ["插件", "技能", "MCP", "个人", "公开", "添加 MCP"] },
      });
      await ctx.prove("公开目录从 iPolloCloud 加载并支持搜索", {
        voiceover: "切到公开可以浏览 iPolloCloud 上的工具。输入关键词可以快速找到需要的连接。",
        action: async () => {
          await ctx.clickText("公开", { selector: sources });
          await ctx.waitForText("Linear");
          await ctx.fill('input[aria-label="搜索 MCP 名称或说明"]', "Notion");
        },
        assert: async () => {
          await ctx.waitForText("Notion");
          await ctx.expectNoText("Linear");
        },
        screenshot: { name: "public-mcp", requireText: ["Notion", "公开"], rejectText: ["Linear"] },
      });
      await ctx.prove("切换企业后从扩展查看目录", {
        voiceover: "在设置的账号页切换到企业空间。再打开扩展里的 MCP，就会出现企业名称和它的工具目录。",
        action: async () => {
          const project = await ctx.eval(`location.hash.startsWith("#/workspace/") ? location.hash.slice(1).split("/").slice(0, 3).join("/") : ""`);
          await ctx.navigateHash(`${project}/settings/cloud-account`);
          await ctx.clickText(enterprise, { selector: workspaces });
          await openExtensions();
          await ctx.clickText("MCP", { selector: tabs });
          await ctx.clickText(enterprise, { selector: sources });
        },
        assert: () => ctx.waitForText("暂无可用的企业 MCP。"),
        screenshot: { name: "enterprise-mcp", requireText: ["MCP", "暂无可用的企业 MCP", "分配使用权限"] },
      });
    },
  }],
};
