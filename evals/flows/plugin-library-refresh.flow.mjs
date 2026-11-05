const pluginLogos = [
  { name: "Xiaohongshu Operations", localizedName: "小红书运营台", file: "ext-xiaohongshu.png" },
  { name: "Douyin Operations", localizedName: "抖音运营台", file: "ext-douyin.png" },
  { name: "WeChat Channels Operations", localizedName: "视频号运营台", file: "ext-wechat-channels.png" },
  { name: "Operation Recorder", localizedName: "操作录制", file: "ext-operation-recorder.png" },
  { name: "iPollo Onto", localizedName: "iPollo Onto", file: "ext-onto.png" },
  { name: "Short Video Studio", localizedName: "短片创作工作台", file: "ext-short-video.png" },
];

export default {
  id: "plugin-library-refresh",
  title: "Refresh the installed plugin library",
  kind: "user-facing",
  steps: [{
    name: "Refresh plugins without losing the installed library",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      await ctx.control("settings.panel.open", { panel: "extensions" });
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
          await ctx.waitFor(`Boolean([...document.querySelectorAll('[data-testid="plugin-package-list-item"] img')]
            .find(img => img.src.endsWith('/ext-xiaohongshu.png') && img.complete && img.naturalWidth > 0))`, {
            timeoutMs: 30_000,
            label: "bundled catalog rendered after refresh",
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
        screenshot: {
          name: "plugin-library-refreshed",
          requireText: ["iPolloWork"],
          rejectText: ["Failed to load plugin packages", "无法加载插件包", "Something went wrong"],
        },
      }).finally(async () => {
        await ctx.eval(`window.__restorePluginRefreshFetch?.(); delete window.__restorePluginRefreshFetch; delete window.__pluginRefreshProof;`);
      });
    },
  }, ...["light", "dark"].flatMap((theme) => pluginLogos.map((plugin) => ({
    name: `Show ${plugin.name}'s approved logo in ${theme} mode`,
    run: async (ctx) => {
      let visibleName;
      await ctx.prove(`${plugin.name} displays its own local PNG in the ${theme} plugin catalog`, {
        voiceover: `搜索${plugin.localizedName}，${theme === "dark" ? "深色" : "浅色"}列表显示对应的黑白图标，便于辨认插件。`,
        action: async () => {
          if (await ctx.eval("document.documentElement.dataset.theme") !== theme) {
            await ctx.control("settings.panel.open", { panel: "appearance" });
            const labels = theme === "dark" ? ["Dark", "深色"] : ["Light", "浅色"];
            await ctx.waitFor(`Boolean([...document.querySelectorAll('button')]
              .find(button => ${JSON.stringify(labels)}.includes(button.getAttribute('aria-label'))))`);
            await ctx.eval(`([...document.querySelectorAll('button')]
              .find(button => ${JSON.stringify(labels)}.includes(button.getAttribute('aria-label')))).click()`);
            await ctx.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
            await ctx.control("settings.panel.open", { panel: "extensions" });
            await ctx.waitFor(`Boolean(document.querySelector('input[aria-label="Search plugins"], input[aria-label="搜索插件"]'))`);
          }
          await ctx.eval(`(() => {
            [...document.querySelectorAll('[role="tab"]')]
              .find(tab => ['个人', 'Personal'].includes(tab.textContent.trim()))?.click();
          })()`);
          await ctx.fill('input[aria-label="Search plugins"], input[aria-label="搜索插件"]', "");
          await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(plugin.name)})
            || document.body.innerText.includes(${JSON.stringify(plugin.localizedName)})`, { timeoutMs: 30_000 });
          visibleName = await ctx.eval(`document.body.innerText.includes(${JSON.stringify(plugin.name)})
            ? ${JSON.stringify(plugin.name)} : ${JSON.stringify(plugin.localizedName)}`);
          await ctx.fill('input[aria-label="Search plugins"], input[aria-label="搜索插件"]', visibleName);
          await ctx.waitFor(`Boolean([...document.querySelectorAll('[data-testid="plugin-package-list-item"] img')]
            .find(img => img.src.endsWith(${JSON.stringify(plugin.file)}) && img.complete && img.naturalWidth > 0))`, {
            timeoutMs: 15_000,
            label: `${plugin.name} loaded logo`,
          });
        },
        assert: async () => {
          const logo = await ctx.eval(`(() => {
            const img = [...document.querySelectorAll('[data-testid="plugin-package-list-item"] img')]
              .find(img => img.src.endsWith(${JSON.stringify(plugin.file)}));
            const row = img?.closest('[data-testid="plugin-package-list-item"]');
            return { loaded: Boolean(img?.complete && img.naturalWidth > 0),
              ownRow: Boolean(row?.innerText.includes(${JSON.stringify(plugin.name)})
                || row?.innerText.includes(${JSON.stringify(plugin.localizedName)})),
              visible: Boolean(img?.getClientRects().length) };
          })()`);
          ctx.assert(logo.loaded && logo.ownRow && logo.visible, `${plugin.name} logo is missing or on the wrong row.`);
          const bounds = await ctx.eval(`(async () => {
            const img = [...document.querySelectorAll('[data-testid="plugin-package-list-item"] img')]
              .find(img => img.src.endsWith(${JSON.stringify(plugin.file)}));
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(img, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
              if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
              left = Math.min(left, x); top = Math.min(top, y);
              right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
            }
            const rect = img.getBoundingClientRect();
            const tile = img.parentElement.getBoundingClientRect();
            const visibleWidth = (right - left) / canvas.width * rect.width;
            const visibleHeight = (bottom - top) / canvas.height * rect.height;
            const centerX = rect.left + (left + right) / 2 / canvas.width * rect.width;
            const centerY = rect.top + (top + bottom) / 2 / canvas.height * rect.height;
            return {
              visibleWidth, visibleHeight,
              sizeRatio: Math.max(visibleWidth, visibleHeight) / parseFloat(getComputedStyle(img).width),
              centerOffset: Math.max(Math.abs(centerX - tile.left - tile.width / 2), Math.abs(centerY - tile.top - tile.height / 2)),
              contained: centerX - visibleWidth / 2 >= tile.left && centerX + visibleWidth / 2 <= tile.right
                && centerY - visibleHeight / 2 >= tile.top && centerY + visibleHeight / 2 <= tile.bottom,
            };
          })()`, { awaitPromise: true });
          ctx.assert(bounds.sizeRatio >= 0.95 && bounds.sizeRatio <= 1.05, `${plugin.name} visible mark does not match adjacent full-size logos: ${JSON.stringify(bounds)}`);
          ctx.assert(bounds.centerOffset < 0.75 && bounds.contained, `${plugin.name} mark is off-center or clipped: ${JSON.stringify(bounds)}`);
          if (theme === "dark") {
            const styles = await ctx.eval(`(() => {
              const img = [...document.querySelectorAll('[data-testid="plugin-package-list-item"] img')]
                .find(img => img.src.endsWith(${JSON.stringify(plugin.file)}));
              return { filter: getComputedStyle(img).filter, blend: getComputedStyle(img).mixBlendMode };
            })()`);
            ctx.assert(styles.filter === "invert(1)" && styles.blend === "difference", `${plugin.name} lacks dark background contrast.`);
          }
        },
        screenshot: {
          name: `${plugin.file.replace(".png", "")}-${theme}`,
          get requireText() { return [visibleName]; },
          rejectText: ["Something went wrong"],
        },
      });
    },
  })))],
};
