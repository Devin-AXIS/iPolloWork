export default {
  id: "plugin-library-refresh",
  title: "Refresh the installed plugin library",
  kind: "user-facing",
  steps: [{
    name: "Refresh plugins without losing the installed library",
    run: async (ctx) => {
      await ctx.navigateHash("/settings/extensions");
      await ctx.waitFor(`document.querySelector('[data-testid="plugin-installed-tile"]') !== null`, {
        timeoutMs: 30_000,
        label: "installed plugins",
      });
      await ctx.prove("Installed plugins and the bundled catalog load after refresh", {
        voiceover: "点击刷新后，已安装的插件正常显示，不再出现无法加载插件包的提示。",
        action: async () => {
          await ctx.eval(`(() => {
            const original = window.fetch;
            window.__pluginRefreshProof = [];
            window.__restorePluginRefreshFetch = () => { window.fetch = original; };
            window.fetch = async (...args) => {
              const response = await original(...args);
              if (/\\/plugin-packages(?:\\/catalog)?$/.test(response.url)) {
                const body = await response.clone().json();
                window.__pluginRefreshProof.push({
                  status: response.status,
                  catalog: response.url.endsWith('/catalog'),
                  count: body.items?.length ?? 0,
                });
              }
              return response;
            };
            [...document.querySelectorAll('button')]
              .find(button => ['刷新', 'Refresh'].includes(button.textContent.trim())).click();
          })()`);
          await ctx.waitFor(`window.__pluginRefreshProof?.length >= 2`, {
            timeoutMs: 30_000,
            label: "both plugin list responses",
          });
        },
        assert: async () => {
          const result = await ctx.eval(`({
            responses: window.__pluginRefreshProof,
            installed: document.querySelectorAll('[data-testid="plugin-installed-tile"]').length,
            error: /无法加载插件包|Failed to load plugin packages/.test(document.body.innerText),
          })`);
          ctx.assert(result.responses.some(item => !item.catalog && item.status === 200 && item.count > 0), "Installed plugins did not load.");
          ctx.assert(result.responses.some(item => item.catalog && item.status === 200 && item.count > 0), "Bundled catalog did not load.");
          ctx.assert(result.installed > 0 && !result.error, "Plugin cards or error state are incorrect.");
        },
        screenshot: "plugin-library-refreshed",
      }).finally(async () => {
        await ctx.eval(`window.__restorePluginRefreshFetch?.(); delete window.__restorePluginRefreshFetch; delete window.__pluginRefreshProof;`);
      });
    },
  }],
};
