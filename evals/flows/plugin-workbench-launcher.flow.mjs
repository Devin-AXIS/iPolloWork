import { connect, evaluate, listTargets } from '../runner/cdp.mjs';

// JSON array of { pluginId, resourceId, label, requireText, external? }.
// Fixtures belong to their plugin repositories; this checks the host boundary.
export default {
  id: 'plugin-workbench-launcher', title: '从右侧菜单打开独立安装的插件工作台', kind: 'user-facing', preserveTheme: true,
  requiredEnv: ['IPOLLOWORK_EVAL_WORKBENCHES'],
  steps: [{ name: '安装资源通过通用菜单启动并显示真实页面', async run(ctx) {
    const workbenches = JSON.parse(process.env.IPOLLOWORK_EVAL_WORKBENCHES);
    ctx.assert(Array.isArray(workbenches) && workbenches.length > 0, 'Provide at least one installed workbench.');
    const launcher = `document.querySelector('[aria-label="添加侧面板入口"]')`;
    await ctx.waitFor(`Boolean(${launcher})`);
    for (const item of workbenches) {
      ctx.assert(item.pluginId && item.resourceId && item.label && item.requireText?.length, 'Workbench fixture is incomplete.');
      const selector = `[data-testid="side-panel-launcher-workspace-app:${item.pluginId}:workspace-app:${item.resourceId}"]`;
      const entry = `document.querySelector(${JSON.stringify(selector)})`;
      const frame = `document.querySelector(${JSON.stringify(`iframe[title="${item.label}"]`)})`;
      if (!await ctx.eval(`Boolean(${entry})`)) await ctx.eval(`${launcher}.click()`);
      await ctx.waitFor(`Boolean(${entry})`);
      await ctx.eval(`${entry}.click()`);
      await ctx.waitFor(`Boolean(${frame}?.src)`, { timeoutMs: 60_000 });
      const origin = new URL(await ctx.eval(`${frame}.src`)).origin;
      let target;
      for (let attempt = 0; attempt < 40; attempt++) {
        target = (await listTargets(ctx.cdpBaseUrl)).find(value => value.type === 'iframe' && value.url.startsWith(origin + '/'));
        if (target) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      ctx.assert(Boolean(target), 'Workbench did not load an embedded page.');
      const client = await connect(target.webSocketDebuggerUrl);
      try {
        let text = '';
        for (let attempt = 0; attempt < 40; attempt++) {
          text = await evaluate(client, 'document.body?.innerText || ""');
          if (item.requireText.every(label => text.includes(label))) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        await ctx.prove(`${item.label}从已安装资源打开`, {
          voiceover: `从右侧加号打开${item.label}，主软件加载已安装的独立插件并显示工作台。`,
          assert: async () => {
            ctx.assert(item.requireText.every(label => text.includes(label)), 'Workbench content is missing.');
            ctx.assert(await ctx.eval(`${frame}.getBoundingClientRect().width > 200`), 'Workbench is not visible.');
            const tab = `[aria-label="Select tab: ${item.label}"]`;
            ctx.assert(await ctx.eval(`document.querySelectorAll(${JSON.stringify(tab)}).length === 1`), 'Workbench tab is duplicated.');
            if (item.external) {
              const bundled = await ctx.eval(`(async () => {
                const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
                const response = await fetch(info.baseUrl + '/workspace/' + location.hash.split('/')[2] + '/plugin-packages/catalog', {
                  headers: { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken },
                });
                if (!response.ok) throw new Error('Catalog HTTP ' + response.status);
                return (await response.json()).items.some(value => value.pluginId === ${JSON.stringify(item.pluginId)});
              })()`, { awaitPromise: true });
              ctx.assert(!bundled, 'External plugin must not depend on the bundled catalog.');
            }
          },
          screenshot: { name: item.pluginId + '-installed-workbench', textTargetId: target.id, requireText: item.requireText },
        });
      } finally { client.close(); }
    }
  } }],
};
