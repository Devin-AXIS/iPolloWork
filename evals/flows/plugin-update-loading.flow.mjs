export default {
  id: "plugin-update-loading",
  title: "Update Video with visible loading and preserved reference ownership",
  kind: "user-facing",
  cdpTarget: { title: "Plugin update proof" },
  steps: [{ name: "Load and update the plugin library", run: async ctx => {
    await ctx.waitFor(`document.querySelector('[data-testid="plugin-installed-tile"]') !== null`, { timeoutMs: 30_000 });
    await ctx.prove("The plugin library shows loading while refreshing", {
      voiceover: "进入插件库后，加载中的转圈提示让等待过程清晰可见。",
      action: async () => {
        await ctx.eval(`document.querySelector('[data-testid="proof-refresh"]').click()`);
        await ctx.waitFor(`document.querySelector('[data-testid="plugin-library-loading"] .animate-spin') !== null`);
      },
      assert: async () => ctx.assert(await ctx.eval(`document.querySelector('[data-testid="plugin-library-source"] [data-testid="plugin-library-loading"]')?.getAttribute('role') === 'status'`), "Missing loading status inside the Personal tab"),
      screenshot: { name: "plugin-library-loading", requireText: ["插件"] },
    });
    await ctx.waitFor(`document.querySelector('[data-testid="plugin-library-loading"]') === null`);
    await ctx.prove("Video update shows a spinner and prevents repeat clicks", {
      voiceover: "点击 iPollo Video 更新后，按钮转圈并暂时禁用，避免重复提交。",
      action: async () => {
        await ctx.eval(`(() => {const row=[...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].find(e=>e.innerText.includes('iPollo Video')); row.querySelector('button:last-child').click()})()`);
        await ctx.waitFor(`document.querySelector('button[aria-busy="true"] .animate-spin') !== null`);
      },
      assert: async () => ctx.assert(await ctx.eval(`document.querySelector('button[aria-busy="true"]').disabled`), "Update button is not disabled"),
      screenshot: { name: "video-update-loading", requireText: ["iPollo Video"] },
    });
    await ctx.prove("The update completes and replaces only verified historical references", {
      voiceover: "更新完成后，旧版参考文件已安全换成新版，插件列表正常显示。",
      action: async () => {
        await ctx.waitFor(`document.querySelector('button[aria-busy="true"]') === null && document.querySelector('[data-testid="plugin-library-loading"]') === null`, { timeoutMs: 30_000 });
      },
      assert: async () => {
        const result = await ctx.eval(`fetch('/observe').then(r=>r.json())`);
        ctx.assert(result.updateResult?.status === "updated", "Update did not complete");
        ctx.assert(result.files.length === 3 && result.files.every(file=>file.matches), "Reference files did not match the new package");
        ctx.assert(await ctx.eval(`document.querySelector('[role="alert"]') === null && document.querySelector('[data-testid="plugin-installed-tile"]') !== null`), "Library shows an error or lost the plugin");
      },
      screenshot: { name: "video-update-complete", requireText: ["iPollo Video"], rejectText: ["内容不同", "无法加载插件包"] },
    });
  } }],
};
