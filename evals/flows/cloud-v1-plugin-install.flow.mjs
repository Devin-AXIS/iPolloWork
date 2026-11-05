const PLUGIN_NAME = "数据标注";

export default {
  id: "cloud-v1-plugin-install",
  title: "Cloud V1 plugin installs through the desktop package lifecycle",
  kind: "user-facing",
  steps: [
    {
      name: "Install the Cloud plugin and open its local detail",
      run: async (ctx) => {
        await ctx.prove("A Cloud V1 plugin persists as installed and opens without a server error", {
          voiceover: "数据标注已经完成安装，我从列表打开它的本地详情，页面明确显示已安装，没有再出现服务器错误。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 30_000,
              label: "iPolloWork control surface",
            });
            await ctx.control("settings.panel.open", { panel: "extensions" });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-library-source"]'))`, {
              timeoutMs: 30_000,
              label: "plugin library source tabs",
            });
            const publicSourceOpened = await ctx.eval(`(() => {
              const tab = [...document.querySelectorAll('[data-testid="plugin-library-source"] [role="tab"]')]
                .find((entry) => ['公开', 'Public'].includes(entry.innerText.trim()));
              tab?.click();
              return Boolean(tab);
            })()`);
            ctx.assert(publicSourceOpened, "The public Cloud plugin source could not be opened.");
            await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(PLUGIN_NAME)})`, {
              timeoutMs: 30_000,
              label: "Cloud plugin row",
            });
            await ctx.waitFor(`(() => {
              const row = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')]
                .find((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}));
              const button = row?.querySelector('button:not(:first-child)');
              return Boolean(button && button.disabled && ['已安装', 'Installed'].includes(button.innerText.trim()));
            })()`, {
              timeoutMs: 30_000,
              label: "persisted Cloud plugin status",
            });
            const installState = await ctx.eval(`(() => {
              const row = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')]
                .find((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}));
              const button = row?.querySelector('button:not(:first-child)');
              return { row: row?.innerText ?? '', button: button?.innerText.trim() ?? '', disabled: button?.disabled ?? true };
            })()`);
            ctx.assert(Boolean(installState.row), `Cloud plugin row is missing: ${JSON.stringify(installState)}`);
            ctx.assert(["已安装", "Installed"].includes(installState.button) && installState.disabled,
              `Cloud plugin is not persisted as installed: ${JSON.stringify(installState)}`);
            const opened = await ctx.eval(`(() => {
              const row = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')]
                .find((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}));
              const button = row?.querySelector('button:first-child');
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(opened, "The installed Cloud plugin could not be opened.");
            await ctx.waitFor(`location.hash.includes('/settings/extensions/plugin/')`, {
              timeoutMs: 30_000,
              label: "installed plugin detail route",
            });
            await ctx.waitFor(`(() => {
              const heading = [...document.querySelectorAll('h2')]
                .find((entry) => entry.innerText.includes(${JSON.stringify(PLUGIN_NAME)}) && entry.getClientRects().length > 0);
              const installed = [...document.querySelectorAll('div, span')]
                .some((entry) => ['已安装', 'Installed'].includes(entry.innerText.trim()) && entry.getClientRects().length > 0);
              return Boolean(heading && installed);
            })()`, {
              timeoutMs: 30_000,
              label: "installed plugin detail",
            });
          },
          assert: async () => {
            const result = await ctx.eval(`({ route: location.hash, text: document.body.innerText, alerts: [...document.querySelectorAll('[role="alert"]')].map((entry) => entry.innerText) })`);
            ctx.assert(result.route.includes("/settings/extensions/plugin/"), `Plugin detail did not open: ${result.route}`);
            ctx.assert(result.text.includes(PLUGIN_NAME), "Installed plugin detail is missing the plugin name.");
            ctx.assert(!result.text.includes("Unexpected server error"), `Unexpected server error remains visible: ${JSON.stringify(result.alerts)}`);
            ctx.assert(!result.text.includes("无法安装这个插件包"), `Install failure remains visible: ${JSON.stringify(result.alerts)}`);
          },
          screenshot: {
            name: "cloud-v1-plugin-installed",
            requireText: [PLUGIN_NAME, "已安装"],
            rejectText: ["Unexpected server error", "无法安装这个插件包", "Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/",
          },
        });
      },
    },
  ],
};
