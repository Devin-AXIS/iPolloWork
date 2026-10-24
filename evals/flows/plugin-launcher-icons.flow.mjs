export default {
  id: "plugin-launcher-icons",
  title: "插件菜单显示加载状态与插件图标",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "plugin-launcher-proof.html" },
  steps: [{ name: "首次读取、完成和刷新", async run(ctx) {
    await ctx.client.send("Page.reload", { ignoreCache: true });
    await ctx.waitFor("Boolean(document.querySelector('[aria-label=添加侧面板入口]'))");
    await ctx.prove("首次读取插件时，菜单显示加载提示且保留基础入口", {
      voiceover: "打开侧面板菜单，插件还在读取时会显示加载提示。",
      action: () => ctx.trustedClick('[aria-label="添加侧面板入口"]'),
      assert: async () => {
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=side-panel-plugins-loading]'))");
        ctx.assert(await ctx.eval("document.querySelector('[data-slot=dropdown-menu-content]').getAttribute('aria-busy') === 'true'"), "Menu must announce loading");
      },
      screenshot: { name: "initial-loading", requireText: ["加载中", "插件工坊", "网页"] },
    });
    await ctx.prove("插件读取完成后显示全部名称和图标，无图标与损坏图标保留通用图标", {
      voiceover: "加载完成后，各插件显示自己的图标；没有可用图标的插件保留通用图标。",
      action: () => ctx.eval("window.dispatchEvent(new Event('proof-release'))"),
      assert: async () => {
        await ctx.waitFor(`(() => {
          const images = [...document.querySelectorAll('[data-testid^=side-panel-launcher-] img')];
          return images.length === 7 && images.every(image => image.complete && image.naturalWidth > 0)
            && !document.querySelector('[data-testid=side-panel-plugins-loading]')
            && !!document.querySelector('[data-testid=side-panel-launcher-broken-icon] svg');
        })()`);
        ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=side-panel-launcher-no-icon] svg'))"), "Missing icon must retain fallback");
      },
      screenshot: { name: "plugin-icons", requireText: ["操作录制", "抖音运营台", "小红书运营台", "iPollo Onto"], rejectText: ["加载中"] },
    });
    await ctx.prove("后台刷新保留已有插件，不再次显示首次加载提示", {
      voiceover: "再次刷新时，已显示的插件保持可见，仍然可以使用。",
      action: () => ctx.eval("window.dispatchEvent(new Event('focus'))"),
      assert: async () => {
        await ctx.waitFor("Number(document.body.dataset.requests) >= 2");
        ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid^=side-panel-launcher-]').length === 12 && !document.querySelector('[data-testid=side-panel-plugins-loading]')"), "Refresh must retain plugin rows");
        await ctx.eval("window.dispatchEvent(new Event('proof-release'))");
        await ctx.client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
        await ctx.eval("document.documentElement.dataset.theme = 'dark'");
      },
      screenshot: { name: "refresh-dark", requireText: ["素材工作台", "视频号运营台"], rejectText: ["加载中"] },
    });
  } }],
};
