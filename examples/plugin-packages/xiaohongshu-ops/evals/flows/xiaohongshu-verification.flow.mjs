import { connect, listTargets } from '../run.mjs';

const origin = process.env.XHS_OPS_ORIGIN;
const profileId = process.env.XHS_OPS_PROOF_PROFILE_ID;
const appCdp = process.env.IPOLLOWORK_APP_CDP_URL;

export default {
  id: 'xiaohongshu-verification',
  title: '小红书多账号登录状态自动识别',
  kind: 'user-facing',
  requiredEnv: ['XHS_OPS_ORIGIN', 'XHS_OPS_PROOF_PROFILE_ID', 'IPOLLOWORK_APP_CDP_URL'],
  preserveTheme: true,
  cdpTarget: { urlIncludes: origin },
  steps: [{
    name: '后台标签中的已登录账号不受其他账号任务绑定影响',
    async run(ctx) {
      const target = (await listTargets(appCdp)).find(tab => tab.type === 'page' && tab.url.startsWith('http://localhost:5173'));
      ctx.assert(Boolean(target), 'Open the desktop app on the existing account management task.');
      const app = await connect(target.webSocketDebuggerUrl);
      const appEval = async expression => {
        const result = await app.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      const savedState = async () => JSON.parse((await (await fetch(origin + '/api/state')).json()).state);
      try {
        await ctx.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await ctx.client.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
        await ctx.client.send('Page.navigate', { url: origin + '/accounts' });
        await ctx.waitFor('document.readyState === "complete" && Boolean(document.querySelector("#page-data"))');
        const accounts = await ctx.eval('JSON.parse(document.querySelector("#page-data").textContent).accounts');
        const account = accounts.find(item => item.expectedProfileId === profileId);
        ctx.assert(account && !account.workerThreadId, 'Use an account that is logged into its browser but has no task binding.');
        const other = accounts.find(item => item.workerThreadId && item.id !== account.id);
        ctx.assert(Boolean(other), 'Keep another account bound to the current task to reproduce this regression.');
        const browserState = await appEval('window.__IPOLLOWORK_ELECTRON__.browser.getState()');
        const browserTab = browserState.tabs.find(tab => tab.profileId === 'xiaohongshu-ops:' + account.browserProfileId && tab.url === 'https://creator.xiaohongshu.com/new/home');
        ctx.assert(browserTab && browserTab.id !== browserState.activeTabId, 'Leave the logged-in profile in a background browser tab.');
        const snapshot = await appEval('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: browserTab.id }) + ')');
        ctx.assert(snapshot.tree.includes('小红书账号: ' + profileId), 'The real platform profile was not observed.');
        const before = await savedState();
        await ctx.prove('返回运营台后识别后台标签中的已登录账号，并保留另一个账号的任务绑定', {
          voiceover: '数字飓风已在独立浏览器中登录。打开运营台后会自动显示已登录和登录正常，不会因为当前任务绑定了其他账号而误报未登录。',
          action: async () => {
            ctx.assert(await appEval('location.hash.endsWith(' + JSON.stringify('/session/' + other.workerThreadId) + ')'), 'Open the task already bound to the other account before running this proof.');
            await appEval(`document.querySelector('button[aria-label="打开右侧面板"]')?.click()`);
            for (let attempt = 0; attempt < 20; attempt++) {
              if (await appEval(`Boolean(document.querySelector('button[aria-label="添加侧面板入口"], button[aria-label="Select tab: 小红书运营台"]'))`)) break;
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            await appEval(`(() => { const tab = document.querySelector('button[aria-label="Select tab: 小红书运营台"]'); if (tab) { tab.click(); return; } const entry = document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]'); if (entry) { entry.click(); return; } document.querySelector('button[aria-label="添加侧面板入口"]').click(); })()`);
            await new Promise(resolve => setTimeout(resolve, 150));
            await appEval(`document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]')?.click()`);
            let verified = false;
            for (let attempt = 0; attempt < 60; attempt++) {
              if ((await savedState()).accounts.some(item => item[0] === account.id && item[1] === 'healthy')) { verified = true; break; }
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            ctx.assert(verified, 'The desktop observer did not confirm the background profile login.');
            await ctx.client.send('Page.navigate', { url: origin + '/accounts' });
            await ctx.waitFor('document.readyState === "complete" && document.body.innerText.includes("登录正常")');
          },
          assert: async () => {
            const after = await savedState();
            ctx.assert(JSON.stringify(after.jobs) === JSON.stringify(before.jobs), 'Login observation changed execution jobs.');
            const updated = await ctx.eval('JSON.parse(document.querySelector("#page-data").textContent).accounts');
            ctx.assert(JSON.stringify(updated.find(item => item.id === other.id)) === JSON.stringify(other), 'Another account binding or login was changed.');
            const actual = updated.find(item => item.id === account.id);
            ctx.assert(actual.sessionStatus === 'healthy' && !actual.workerThreadId && actual.lastVerifiedAt, 'Login is still coupled to task binding.');
            const text = await ctx.eval(`document.querySelector('[data-account-id="${account.id}"]').innerText`);
            ctx.assert(text.includes('已登录') && text.includes('登录正常') && !text.includes('登录后即可安排任务'), 'Account status copy is misleading.');
          },
          screenshot: { name: 'background-account-login-confirmed', requireText: ['已登录', '登录正常', '删除绑定'] },
        });
      } finally {
        app.close();
        await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      }
    },
  }],
};
