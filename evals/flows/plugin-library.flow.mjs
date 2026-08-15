export default {
  id: "plugin-library",
  title: "Unified plugin library navigation and catalog",
  kind: "user-facing",
  steps: [
    {
      name: "Open the unified plugin library",
      run: async (ctx) => {
        await ctx.prove("Plugins open as one searchable capability-package library", {
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitFor(`Boolean([...document.querySelectorAll('[role="tab"]')]
              .find((entry) => ['插件', 'Plugins'].includes(entry.textContent?.trim() ?? '')))`, {
              timeoutMs: 30_000,
              label: "plugin library tab",
            });
            const pluginsSelected = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['插件', 'Plugins'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(pluginsSelected, "Plugins tab was not found.");
            await ctx.waitFor(`Boolean(document.querySelector('input[aria-label="搜索插件"], input[aria-label="Search plugins"]'))`, {
              timeoutMs: 30_000,
              label: "plugin library search",
            });
            await ctx.waitFor(`(() => {
              const text = document.body.innerText;
              const loading = text.includes('正在加载市场') || text.includes('Loading marketplace');
              const settled = [
                '精选',
                'Featured',
                'AI Agent 与自动化',
                'AI Agents & Automation',
                '市场暂无插件',
                'No marketplace plugins',
                '登录后浏览插件市场',
                'Sign in to browse the plugin marketplace',
              ].some((value) => text.includes(value));
              return !loading && settled;
            })()`, {
              timeoutMs: 30_000,
              label: "settled marketplace catalog",
            });
          },
          assert: async () => {
            await ctx.expectText("插件");
            await ctx.expectText("技能");
            await ctx.expectText("已安装");
            await ctx.expectText("市场");
            await ctx.expectText("个人");
            await ctx.expectNoText("添加自定义应用");
            await ctx.expectNoText("你的应用");
          },
          screenshot: {
            name: "plugin-library-marketplace",
            requireText: ["插件", "技能", "已安装", "市场", "个人"],
            rejectText: ["添加自定义应用", "你的应用", "Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Switch to personal plugin packages",
      run: async (ctx) => {
        await ctx.prove("Personal packages stay in the same library without exposing raw MCP rows", {
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(clicked, "Personal plugin source tab was not found.");
            await ctx.waitFor(`document.body.innerText.includes('个人插件') || document.body.innerText.includes('Personal plugins')`, {
              timeoutMs: 30_000,
              label: "personal plugin packages",
            });
          },
          assert: async () => {
            await ctx.expectNoText("可用应用");
            await ctx.expectNoText("你的应用");
          },
          screenshot: {
            name: "plugin-library-personal",
            requireText: ["个人插件", "已安装"],
            rejectText: ["可用应用", "你的应用", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Switch to the skills index",
      run: async (ctx) => {
        await ctx.prove("Skills remain a first-class index inside the same extension surface", {
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['技能', 'Skills'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(clicked, "Skills tab was not found.");
            await ctx.waitFor(`Boolean(document.querySelector('input[placeholder="搜索已安装、团队和中心skills"], input[placeholder="Search installed, team, and hub skills"]'))`, {
              timeoutMs: 30_000,
              label: "skills index",
            });
          },
          assert: async () => {
            await ctx.expectText("导入本地skill");
            await ctx.expectNoText("添加自定义应用");
          },
          screenshot: {
            name: "plugin-library-skills",
            requireText: ["技能", "导入本地skill"],
            rejectText: ["添加自定义应用", "Something went wrong"],
          },
        });
      },
    },
  ],
};
