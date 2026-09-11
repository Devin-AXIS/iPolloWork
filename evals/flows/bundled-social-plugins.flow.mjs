const plugins = [
  { id: "xiaohongshu-ops", name: "小红书运营台", version: "0.4.14" },
  { id: "douyin-ops", name: "抖音运营台", version: "0.1.5" },
];

export default {
  id: "bundled-social-plugins",
  title: "Xiaohongshu and Douyin come from the bundled plugin collection",
  kind: "user-facing",
  steps: [
    {
      name: "Show both bundled social plugins in the personal catalog",
      run: async (ctx) => {
        await ctx.prove("小红书和抖音都由主程序插件集提供", {
          voiceover: "个人插件列表现在直接显示小红书运营台和抖音运营台，安装与更新不再依赖外部本地插件包。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)");
            await ctx.eval(`(() => {
              window.__bundledSocialCatalog = null;
              const original = window.fetch;
              window.__restoreBundledSocialProof = () => { window.fetch = original; };
              window.fetch = async (...args) => {
                const response = await original(...args);
                if (/\\/plugin-packages\\/catalog$/.test(response.url)) {
                  window.__bundledSocialCatalog = await response.clone().json();
                }
                return response;
              };
            })()`);
            const workspaceId = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace') || ''");
            ctx.assert(workspaceId, "An active workspace is required for the plugin catalog");
            await ctx.navigateHash(`/workspace/${workspaceId}/settings/extensions`);
            await ctx.waitFor(`document.querySelector('[data-testid="plugin-library-heading"]') !== null`, { timeoutMs: 30_000 });
            await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('button, [role="tab"]')]
                .find((entry) => ["个人", "Personal"].includes(entry.textContent?.trim() ?? ""));
              tab?.click();
              const refresh = [...document.querySelectorAll('button')]
                .find((entry) => ["刷新", "Refresh"].includes(entry.textContent?.trim() ?? ""));
              refresh?.click();
            })()`);
            await ctx.waitFor("Boolean(window.__bundledSocialCatalog)", { timeoutMs: 60_000, label: "bundled social catalog" });
            await ctx.waitFor(`(() => {
              const text = document.body.innerText;
              return text.includes("小红书运营台") && text.includes("抖音运营台");
            })()`, { timeoutMs: 30_000, label: "social plugin cards" });
            await ctx.eval(`(() => {
              const staleDevLoader = document.querySelector('[data-testid="startup-logo-animation"]');
              if (staleDevLoader?.innerText.includes('spawn opencode ENOENT')) staleDevLoader.remove();
            })()`);
          },
          assert: async () => {
            const catalog = await ctx.eval("window.__bundledSocialCatalog");
            for (const plugin of plugins) {
              const entry = catalog.items.find((item) => item.pluginId === plugin.id);
              ctx.assert(entry?.version === plugin.version, `${plugin.id} did not expose version ${plugin.version}`);
              ctx.assert(entry?.manifest?.source?.origin === "builtin", `${plugin.id} was not loaded from the bundled catalog`);
              ctx.assert(entry?.manifest?.source?.trusted === true, `${plugin.id} was not marked as a reviewed bundle`);
            }
            ctx.assert(!catalog.errors?.some((error) => /xiaohongshu-ops|douyin-ops/.test(error)), `Bundled social catalog error: ${catalog.errors}`);
            const visible = await ctx.eval(`(() => {
              const rows = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')];
              return ${JSON.stringify(plugins.map((plugin) => plugin.name))}.every((name) => rows.some((row) => row.innerText.includes(name)));
            })()`);
            ctx.assert(visible, "Both social plugin cards were not visible in the personal catalog");
            await ctx.output("bundled-social-catalog", JSON.stringify(catalog.items.filter((item) =>
              plugins.some((plugin) => plugin.id === item.pluginId)), null, 2));
          },
          screenshot: {
            name: "bundled-social-plugins",
            requireText: ["小红书运营台", "抖音运营台"],
            rejectText: ["本地插件包未生成", "Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
        await ctx.eval("window.__restoreBundledSocialProof?.(); delete window.__restoreBundledSocialProof; delete window.__bundledSocialCatalog;");
      },
    },
  ],
};
