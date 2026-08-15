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
            const compactStructure = await ctx.eval(`(() => {
              const activeTabs = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
                .map((entry) => entry.textContent?.trim());
              const shellHeader = document.querySelector('main > header');
              const installedIcons = [...document.querySelectorAll('button[aria-label^="打开"], button[aria-label^="Open"]')];
              return {
                personalFirst: activeTabs.includes('个人') || activeTabs.includes('Personal'),
                noExtensionTitle: ![...(shellHeader?.querySelectorAll('h1') ?? [])]
                  .some((entry) => ['扩展', 'Extensions'].includes(entry.textContent?.trim() ?? '')),
                compactIcons: installedIcons.every((entry) => entry.getBoundingClientRect().width <= 37),
              };
            })()`);
            ctx.assert(compactStructure.personalFirst, "Personal plugins should be the default source.");
            ctx.assert(compactStructure.noExtensionTitle, "The shell header should show plugin tabs instead of an Extensions title.");
            ctx.assert(compactStructure.compactIcons, "Installed plugin icons should use the compact size.");
            const marketplaceSelected = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[role="tab"]')]
                .find((entry) => ['市场', 'Marketplace'].includes(entry.textContent?.trim() ?? ''));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(marketplaceSelected, "Marketplace plugin source tab was not found.");
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
              const pluginIcons = [...document.querySelectorAll('button[aria-label^="打开"] img, button[aria-label^="Open"] img')];
              const iconsLoaded = pluginIcons.length === 0 || pluginIcons.every((image) => image.complete && image.naturalWidth > 0);
              return !loading && settled && iconsLoaded;
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
      name: "Open an installed marketplace plugin",
      run: async (ctx) => {
        await ctx.prove("Installed marketplace entries open the canonical installed plugin detail", {
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const installedLabels = ['已安装', 'Installed'];
              const rows = [...document.querySelectorAll('main div')]
                .filter((entry) => installedLabels.some((label) => entry.innerText?.includes(label)))
                .sort((left, right) => left.querySelectorAll('button').length - right.querySelectorAll('button').length);
              const openButton = rows.find((entry) => entry.querySelectorAll('button').length >= 2)?.querySelector('button');
              openButton?.click();
              return Boolean(openButton);
            })()`);
            ctx.assert(opened, "No installed marketplace plugin could be opened.");
            await ctx.waitFor(`location.hash.includes('/settings/extensions/plugin/')`, {
              timeoutMs: 30_000,
              label: "canonical installed detail from marketplace",
            });
            await ctx.waitFor(`document.body.innerText.includes('启用') || document.body.innerText.includes('Enable')`, {
              timeoutMs: 30_000,
              label: "canonical detail enable control",
            });
          },
          assert: async () => {
            await ctx.expectText("已安装");
            await ctx.expectText("启用");
          },
        });
      },
    },
    {
      name: "Switch to personal plugin packages",
      run: async (ctx) => {
        await ctx.prove("Personal packages stay in the same library without exposing raw MCP rows", {
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitFor(`Boolean([...document.querySelectorAll('[role="tab"]')]
              .find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? '')))`, {
              timeoutMs: 30_000,
              label: "personal plugin source tab",
            });
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
      name: "Open the canonical installed plugin detail",
      run: async (ctx) => {
        await ctx.prove("Installed plugins share one detail page with enablement and authorization state", {
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const authorizationLabels = ['需要授权', 'Authorization required'];
              const rows = [...document.querySelectorAll('main div')]
                .filter((entry) => authorizationLabels.some((label) => entry.innerText?.includes(label)))
                .sort((left, right) => left.querySelectorAll('button').length - right.querySelectorAll('button').length);
              const authorizationButton = rows.find((entry) => entry.querySelectorAll('button').length >= 2)?.querySelector('button');
              const fallbackButton = document.querySelector('button[aria-label^="打开"], button[aria-label^="Open"]');
              const target = authorizationButton ?? fallbackButton;
              target?.click();
              return { clicked: Boolean(target), authorizationExpected: Boolean(authorizationButton) };
            })()`);
            ctx.assert(opened.clicked, "No installed plugin could be opened.");
            await ctx.waitFor(`location.hash.includes('/settings/extensions/plugin/')`, {
              timeoutMs: 30_000,
              label: "canonical plugin detail route",
            });
            await ctx.waitFor(`(() => {
              const text = document.body.innerText;
              return (text.includes('已安装') || text.includes('Installed'))
                && (text.includes('启用') || text.includes('Enable'))
                && Boolean(document.querySelector('[role="switch"]'));
            })()`, {
              timeoutMs: 30_000,
              label: "installed status and enable switch",
            });
            if (opened.authorizationExpected) {
              await ctx.waitFor(`document.body.innerText.includes('需要授权') || document.body.innerText.includes('Authorization required')`, {
                timeoutMs: 30_000,
                label: "authorization required status",
              });
            }
          },
          assert: async () => {
            await ctx.expectText("已安装");
            await ctx.expectText("启用");
          },
          screenshot: {
            name: "plugin-library-detail",
            requireText: ["已安装", "启用"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/",
          },
        });
      },
    },
    {
      name: "Switch to the skills index",
      run: async (ctx) => {
        await ctx.prove("Skills remain a first-class index inside the same extension surface", {
          action: async () => {
            await ctx.navigateHash("/settings/extensions/skills");
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
