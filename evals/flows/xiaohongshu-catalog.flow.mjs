const row = `[...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].find(el => el.innerText.includes('小红书运营台'))`;

export default {
  id: "xiaohongshu-catalog",
  title: "个人插件目录提供小红书运营台安装包",
  kind: "user-facing",
  steps: [{
    name: "未安装的小红书运营台仍在个人目录中可安装",
    async run(ctx) {
      await ctx.navigateHash("/settings/extensions");
      await ctx.waitFor(`${row}?.innerText.includes('安装')`, { timeoutMs: 30_000 });
      await ctx.prove("个人目录提供小红书运营台，未安装时可以直接点击安装", {
        voiceover: "小红书运营台现在在个人插件目录中，点击安装即可添加；卸载后也能从这里重新安装。",
        action: async () => {
          await ctx.waitFor(`[...document.querySelectorAll('button')].some(el => el.textContent.trim() === '刷新')`);
          await ctx.eval(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === '刷新').click()`);
          await ctx.waitFor(`${row}?.innerText.includes('安装')`);
          await ctx.eval(`${row}.scrollIntoView({block:'center'})`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`[...${row}.querySelectorAll('button')].some(el => el.textContent.trim() === '安装' && !el.disabled)`), "Install action is missing or disabled.");
          const item = await ctx.eval(`(async () => {
            const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
            const workspace = location.hash.split('/')[2];
            const response = await fetch(info.baseUrl + '/workspace/' + workspace + '/plugin-packages/catalog', {
              headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken },
            });
            if (!response.ok) throw new Error('Catalog HTTP ' + response.status);
            return (await response.json()).items.find(item => item.pluginId === 'xiaohongshu-ops');
          })()`, { awaitPromise: true });
          ctx.assert(item?.version === "0.3.10" && item.installedVersion === null, "Catalog entry depends on an existing local installation.");
        },
        screenshot: "xiaohongshu-personal-catalog",
      });
    },
  }],
};
