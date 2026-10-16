// Drive the real host and local archive importer; no plugin-list or panel mocks.
export default {
  id: "plugin-sidebar-shortcuts",
  title: "本地安装插件工坊并自定义左侧快捷入口",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_WORKSHOP_PACKAGE"],
  steps: [{ name: "安装、选择、打开和保存插件快捷入口", async run(ctx) {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    const workspaceId = await ctx.eval("location.hash.split('/')[2]");
    ctx.assert(workspaceId?.startsWith("ws_"), "Use an isolated onboarded workspace.");
    const home = `/workspace/${workspaceId}/session`;
    const shortcut = '[data-testid="sidebar-plugin-shortcut-plugin-workshop"]';
    const menu = '[data-testid="sidebar-plugin-shortcuts-menu"]';
    const option = '[data-testid="sidebar-plugin-shortcut-option-plugin-workshop"]';
    const exists = selector => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
    const click = selector => ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickText = (text, root = "document") => ctx.eval(`(() => {
      const button = [...${root}.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && el.getClientRects().length);
      if (!button || button.disabled) throw new Error('Enabled button missing: ' + ${JSON.stringify(text)});
      button.click();
    })()`);

    await ctx.navigateHash(home);
    await ctx.waitFor(exists(menu));
    await ctx.prove("左侧默认没有固定的插件工坊入口", {
      voiceover: "左侧现在显示插件快捷入口，可以自己选择要放在这里的插件。",
      assert: async () => ctx.assert(!await ctx.eval(exists(shortcut)), "Workshop shortcut must be opt-in."),
      screenshot: { name: "default-sidebar", requireText: ["插件快捷入口"], rejectText: ["Something went wrong"] },
    });

    await ctx.prove("插件工坊通过本地安装包安装成功", {
      voiceover: "在扩展中添加本地插件工坊安装包，确认安装后，插件进入已安装列表。",
      action: async () => {
        await ctx.navigateHash(`/workspace/${workspaceId}/settings/extensions`);
        await ctx.waitFor(exists('[data-testid="plugin-library-heading"]'));
        await ctx.waitFor("[...document.querySelectorAll('button')].some(el => el.textContent.trim() === '添加')");
        await clickText("添加");
        await ctx.waitFor(exists('[data-testid="plugin-package-import-dialog"] input[type="file"]'));
        const { root } = await ctx.client.send("DOM.getDocument");
        const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="plugin-package-import-dialog"] input[type="file"]' });
        await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [process.env.IPOLLOWORK_EVAL_WORKSHOP_PACKAGE] });
        await ctx.waitFor("[...document.querySelectorAll('[data-testid=\"plugin-package-import-dialog\"] button')].some(el => ['安装插件', '更新'].includes(el.textContent.trim()) && !el.disabled)");
        const installLabel = await ctx.eval("[...document.querySelectorAll('[data-testid=\"plugin-package-import-dialog\"] button')].find(el => ['安装插件', '更新'].includes(el.textContent.trim())).textContent.trim()");
        await clickText(installLabel, "document.querySelector('[data-testid=\"plugin-package-import-dialog\"]')");
        await ctx.waitFor(`!${exists('[data-testid="plugin-package-import-dialog"]')}`, { timeoutMs: 60_000 });
      },
      assert: async () => {
        const installed = await ctx.eval(`(async () => {
          const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
          const response = await fetch(info.baseUrl + '/workspace/${workspaceId}/plugin-packages', { headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken } });
          if (!response.ok) throw new Error('Plugin list HTTP ' + response.status);
          return (await response.json()).items.some(item => item.pluginId === 'plugin-workshop' && item.enabled && item.version === ${JSON.stringify(process.env.IPOLLOWORK_EVAL_WORKSHOP_VERSION || "0.1.1")});
        })()`, { awaitPromise: true });
        ctx.assert(installed, "Local package was not persisted as enabled.");
        await ctx.waitForText("插件工坊");
      },
      screenshot: { name: "local-package-installed", requireText: ["插件工坊", "已安装"], rejectText: ["Something went wrong"] },
    });

    await ctx.prove("勾选插件工坊后出现快捷按钮并打开右侧页面", {
      voiceover: "回到对话，在插件快捷入口中勾选插件工坊。左侧出现按钮，点击就能打开右侧工坊。",
      action: async () => {
        await ctx.navigateHash(home);
        await ctx.waitFor(exists(menu));
        await click(menu);
        await ctx.waitFor(exists(option));
        await click(option);
        await click(menu);
        await ctx.waitFor(exists(shortcut));
        await click(shortcut);
        await ctx.waitFor(exists('[data-testid="plugin-workshop-empty"]'), { timeoutMs: 60_000 });
      },
      assert: async () => {
        ctx.assert(await ctx.eval(`document.querySelectorAll(${JSON.stringify(shortcut)}).length === 1`), "Shortcut must appear exactly once.");
        ctx.assert(await ctx.eval("document.querySelector('[data-testid=\"plugin-workshop-empty\"]').getBoundingClientRect().width > 200"), "Workshop panel is not visible.");
      },
      screenshot: { name: "workshop-open", requireText: ["插件工坊", "插件快捷入口"], rejectText: ["Something went wrong"] },
    });

    await ctx.prove("快捷入口刷新后保留并可随时取消", {
      voiceover: "刷新应用后，插件工坊快捷入口仍然保留。取消勾选就会移除按钮，插件本身继续安装在扩展中。",
      action: async () => {
        await ctx.client.send("Page.reload");
        await ctx.waitFor(exists(shortcut), { timeoutMs: 60_000 });
        await ctx.waitFor(exists('[data-testid="plugin-workshop-empty"]'));
        await click(menu);
        await ctx.waitFor(`document.querySelector(${JSON.stringify(option)})?.getAttribute('aria-checked') === 'true'`);
        await click(option);
        await click(menu);
      },
      assert: async () => {
        await ctx.waitFor(`!${exists(shortcut)}`);
        const saved = await ctx.eval("JSON.parse(localStorage.getItem('ipollowork.react.sidebarLayout.v1')).state.pluginShortcutIds");
        ctx.assert(!saved.includes("plugin-workshop"), "Deselection was not persisted.");
        await ctx.waitFor(exists('[data-testid="plugin-workshop-empty"]'));
      },
      screenshot: { name: "shortcut-removed", requireText: ["插件快捷入口", "插件工坊"], rejectText: ["Something went wrong"] },
    });
  } }],
};
