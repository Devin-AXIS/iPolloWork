import { readFile } from 'node:fs/promises';

const latest = JSON.parse(await readFile(new URL('../../examples/plugin-packages/operation-recorder/ipollowork.plugin.json', import.meta.url), 'utf8')).package.version;
const refresh = `(() => { const button = [...document.querySelectorAll('button')].find(button => ['刷新', 'Refresh'].includes(button.textContent.trim())); button?.click(); return Boolean(button); })()`;

export default {
  id: 'bundled-plugin-repair',
  title: '扩展目录资源完整，操作录制安装当前 Node.js 版本',
  kind: 'user-facing',
  preserveTheme: true,
  steps: [{
    name: '刷新插件目录并实际更新操作录制',
    run: async ctx => {
      const workspace = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace')");
      ctx.assert(workspace, 'The current workspace supplies the real plugin catalog.');
      await ctx.navigateHash(`/workspace/${workspace}/settings/extensions`);
      await ctx.waitFor("[...document.querySelectorAll('button')].some(button => ['刷新', 'Refresh'].includes(button.textContent.trim()))");
      await ctx.eval(`(() => {
        window.__pluginFixRestore?.(); delete window.__pluginFixRestore; delete window.__pluginFixObserved;
        const original = window.fetch;
        window.__bundledRepair = { catalog: null, installed: null, result: null };
        window.__restoreBundledRepair = () => { window.fetch = original; };
        window.fetch = async (...args) => {
          const response = await original(...args);
          if (/\\/plugin-packages(?:\\/catalog)?$/.test(response.url)) {
            const body = await response.clone().json();
            window.__bundledRepair[response.url.endsWith('/catalog') ? 'catalog' : 'installed'] = body;
          } else if (/\\/plugin-packages\\/catalog\\/operation-recorder\\/install$/.test(response.url)) {
            window.__bundledRepair.result = { status: response.status, body: await response.clone().json() };
          }
          return response;
        };
      })()`);
      try {
        await ctx.prove('数据标注和短片工作台的资源缺失错误消失，操作录制目录提供最新版', {
          voiceover: '我刷新扩展插件列表，底部的资源缺失错误消失，操作录制显示当前 Node.js 版本。',
          action: async () => { ctx.assert(await ctx.eval(refresh), 'The refresh button is visible.'); },
          assert: async () => {
            await ctx.waitFor('Boolean(window.__bundledRepair.catalog && window.__bundledRepair.installed)', { timeoutMs: 30_000 });
            const catalog = await ctx.eval('window.__bundledRepair.catalog');
            ctx.assert(catalog.errors.length === 0, 'The real catalog has no resource errors.');
            for (const id of ['labelu-data-annotation', 'short-video-studio']) ctx.assert(catalog.items.some(item => item.pluginId === id), `${id} has a complete catalog package.`);
            ctx.assert(catalog.items.find(item => item.pluginId === 'operation-recorder')?.version === latest, 'The catalog advertises the current recorder version.');
            await ctx.waitFor("!document.body.innerText.includes('Package resource is missing')");
          },
          screenshot: { name: 'catalog-resources-ready', requireText: ['操作录制', '短片创作工作台'] },
        });
        await ctx.prove('通过扩展页更新后，已安装的操作录制版本与目录最新版一致', {
          voiceover: '操作录制更新完成后，我打开详情，核对已安装版本与当前目录最新版一致。',
          action: async () => {
            const installed = await ctx.eval("window.__bundledRepair.installed.items.find(item => item.pluginId === 'operation-recorder')?.version");
            if (installed !== latest) {
            await ctx.waitFor(`(() => { const row = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].find(row => row.textContent.includes('操作录制') && [...row.querySelectorAll('button')].some(button => ['更新', 'Update', '安装', 'Install'].includes(button.textContent.trim()) && !button.disabled)); return Boolean(row); })()`);
            ctx.assert(await ctx.eval(`(() => { const row = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].find(row => row.textContent.includes('操作录制') && [...row.querySelectorAll('button')].some(button => ['更新', 'Update', '安装', 'Install'].includes(button.textContent.trim()))); const button = [...row.querySelectorAll('button')].find(button => ['更新', 'Update', '安装', 'Install'].includes(button.textContent.trim())); button.click(); return true; })()`), 'Update targets the recorder row.');
            }
            await ctx.waitFor(`window.__bundledRepair.installed?.items.find(item => item.pluginId === 'operation-recorder')?.version === ${JSON.stringify(latest)}`, { timeoutMs: 60_000 });
            await ctx.waitFor(`(() => { const rows = [...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].filter(row => row.textContent.includes('操作录制')); return rows.length === 1 && rows[0].textContent.includes('统一 Node.js 录制器') && [...rows[0].querySelectorAll('button')].some(button => ['打开', 'Open'].includes(button.textContent.trim()) && !button.disabled); })()`);
            await ctx.eval(`[...document.querySelectorAll('[data-testid="plugin-package-list-item"]')].find(row => row.textContent.includes('操作录制')).querySelector('button').click()`);
          },
          assert: async () => {
            await ctx.waitFor(`window.__bundledRepair.installed?.items.find(item => item.pluginId === 'operation-recorder')?.version === ${JSON.stringify(latest)}`, { timeoutMs: 60_000 });
            const evidence = await ctx.eval("({ catalog: window.__bundledRepair.catalog.items.find(item => item.pluginId === 'operation-recorder'), result: window.__bundledRepair.result })");
            ctx.assert(evidence.catalog.version === latest && evidence.catalog.installedVersion === latest && !evidence.catalog.updateAvailable, 'Catalog and installed version agree after the real update.');
            if (evidence.result) ctx.assert(evidence.result.status === 200 && evidence.result.body.result.version === latest, 'The update endpoint installed the current package.');
            await ctx.waitFor("document.body.innerText.includes('统一 Node.js 录制器') && !document.body.innerText.includes('Package resource is missing')");
            await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify('v' + latest)})`);
            const capability = await ctx.eval(`(async () => {
              const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
              const headers = { authorization: 'Bearer ' + (info.ownerToken || info.clientToken), 'X-iPolloWork-Host-Token': info.hostToken, 'Content-Type': 'application/json' };
              const workspaces = await (await fetch(info.baseUrl + '/workspaces', { headers })).json();
              const workspace = workspaces.items.find(item => item.id === ${JSON.stringify(workspace)});
              const response = await fetch(info.baseUrl + '/experimental/extensions/call', { method: 'POST', headers,
                body: JSON.stringify({ extensionId: 'operation-recorder', action: 'capabilities', args: {}, context: { workspaceId: workspace.id, directory: workspace.path } }) });
              const body = await response.json();
              return { status: response.status, desktop: body.result?.desktop };
            })()`, { awaitPromise: true });
            ctx.assert(capability.status === 200 && capability.desktop?.supported && capability.desktop.backend.startsWith('nodejs-'), 'The installed JavaScript factory and bundled Node.js collector run in the actual Electron host.');
          },
          screenshot: { name: 'recorder-latest-installed', requireText: ['操作录制', '统一 Node.js 录制器', 'v' + latest] },
        });
      } finally {
        await ctx.eval('window.__restoreBundledRepair?.(); delete window.__restoreBundledRepair; delete window.__bundledRepair;');
        await ctx.eval(`(() => { const button = [...document.querySelectorAll('button')].find(button => ['返回插件', 'Back to plugins'].includes(button.textContent.trim())); button?.click(); })()`);
      }
    },
  }],
};
