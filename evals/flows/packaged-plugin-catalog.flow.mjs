export default {
  id: 'packaged-plugin-catalog',
  title: 'Packaged extension library includes every bundled plugin',
  kind: 'user-facing',
  preserveTheme: true,
  steps: [{
    name: 'Open the extension library',
    async run(ctx) {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)');
      const workspaceRoute = await ctx.eval(`location.hash.split('/').slice(0, 3).join('/').slice(1)`);
      ctx.assert(workspaceRoute, 'A workspace must be selected');
      await ctx.navigateHash(`${workspaceRoute}/session`);
      await ctx.waitFor(`!document.querySelector('[data-testid="plugin-library-installed"]')`);
      await ctx.eval(`(() => {
        window.__catalogProof = { responses: [] };
        const original = window.fetch;
        window.__catalogProof.restore = () => { window.fetch = original; };
        window.fetch = async (...args) => {
          const response = await original(...args);
          if (response.url.includes('/plugin-packages/catalog') && !response.url.includes('/install')) {
            const data = await response.clone().json();
            window.__catalogProof.responses.push({ status: response.status, ids: (data.items ?? []).map(item => item.pluginId) });
          }
          return response;
        };
      })()`);
      try {
        await ctx.prove('The packaged extension library loads the complete catalog without the missing video-console error', {
          voiceover: '打开扩展库，内置插件列表完整加载，页面不再显示缺少视频工作台插件包的错误。',
          action: async () => {
            await ctx.navigateHash('/settings/extensions');
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="plugin-library-installed"]'))`, { timeoutMs: 60000 });
            await ctx.waitFor('window.__catalogProof.responses.length > 0', { timeoutMs: 60000 });
            await ctx.eval(`[...document.querySelectorAll('button')].find(el => ['个人','Personal'].includes(el.textContent?.trim()))?.click()`);
          },
          assert: async () => {
            const responses = await ctx.eval('window.__catalogProof.responses');
            ctx.assert(responses.every(item => item.status === 200), 'All catalog requests must succeed');
            ctx.assert(responses.some(item => item.ids.includes('video-console') && item.ids.includes('labelu-data-annotation')), 'Catalog must include video-console and annotation');
            await ctx.waitFor(`document.body.innerText.includes('视频工作台')`, { timeoutMs: 30000 });
            ctx.assert(await ctx.eval(`!document.body.innerText.includes('无法加载插件包') && !document.body.innerText.includes('Bundled plugin package is unavailable')`), 'Library must show no loading error');
          },
          screenshot: { name: 'complete-extension-library', requireText: ['视频工作台', '数据标注实训云'], rejectText: ['无法加载插件包', 'Bundled plugin package is unavailable'] },
        });
      } finally {
        await ctx.eval('window.__catalogProof?.restore()');
      }
    },
  }],
};
