import { connect, evaluate, listTargets } from '../runner/cdp.mjs';

const origin = process.env.XHS_OPS_ORIGIN;
const desktopCdp = process.env.IPOLLOWORK_APP_CDP_URL;
const accountId = Number(process.env.XHS_OPS_PROOF_ACCOUNT_ID);

export default {
  id: 'xiaohongshu-sync-target',
  title: '两个账号同时登录时，同步使用所选账号的浏览器',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['XHS_OPS_ORIGIN', 'IPOLLOWORK_APP_CDP_URL', 'XHS_OPS_PROOF_ACCOUNT_ID'],
  steps: [{
    name: '从实际运营台点击同步并核对两个账号的可见身份',
    async run(ctx) {
      const target = (await listTargets(desktopCdp)).find(t => t.type === 'page' && t.url.includes('localhost:5173'));
      const desktop = await connect(target.webSocketDebuggerUrl);
      const app = expression => evaluate(desktop, expression, { awaitPromise: true });
      let frame;
      try {
        const accounts = await app(`(async () => {
          const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
          const response = await fetch(info.baseUrl + '/experimental/extensions/call', {
            method: 'POST', headers: { Authorization: 'Bearer ' + info.clientToken, 'X-iPolloWork-Host-Token': info.hostToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ extensionId: 'xiaohongshu-ops', action: 'list-accounts', args: {}, context: { workspaceId: location.hash.split('/workspace/')[1].split('/')[0], sessionId: location.hash.split('/session/')[1] } }),
          });
          return (await response.json()).result.accounts;
        })()`);
        const account = accounts.find(a => a.id === accountId);
        const other = accounts.find(a => a.id !== accountId && a.browserProfileId);
        ctx.assert(account?.browserProfileId && other, 'Keep two registered browser profiles logged in before running this proof.');
        const state = await app('window.__IPOLLOWORK_ELECTRON__.browser.getState()');
        const selectedTab = state.tabs.find(t => t.profileId === account.browserProfileId);
        const otherTab = state.tabs.find(t => t.profileId === other.browserProfileId);
        ctx.assert(selectedTab && otherTab, 'Both account browser tabs must already be open.');
        const otherBefore = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: otherTab.id }) + ')');
        ctx.assert(otherBefore.tree.includes(other.expectedProfileId), 'The other logged-in account identity was not visible.');
        await app('window.__IPOLLOWORK_ELECTRON__.browser.openUrl(' + JSON.stringify(otherTab.url) + ', ' + JSON.stringify({ profileId: other.browserProfileId }) + ')');
        await app(`document.querySelector('[aria-label="Select tab: 小红书运营台"]').click()`);
        const frameTarget = (await listTargets(desktopCdp)).find(t => t.type === 'iframe' && t.url.startsWith(origin));
        frame = await connect(frameTarget.webSocketDebuggerUrl);
        const frameEval = expression => evaluate(frame, expression, { awaitPromise: true });
        await frame.send('Page.navigate', { url: origin + '/analytics?account=' + accountId });
        let ready = false;
        for (let i = 0; i < 40; i++) {
          ready = await frameEval(`document.readyState === 'complete' && Boolean(document.querySelector('[data-sync-analytics][data-verify-account="${accountId}"]'))`).catch(() => false);
          if (ready) break;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        ctx.assert(ready, 'The real workbench sync button did not load.');
        await ctx.prove('同步所选账号时复用其独立标签页，另一个账号保持登录', {
          voiceover: '两个账号都保持登录。在数字飓风的数据页点击同步，软件自动选中数字飓风的独立浏览器，另一个账号无需退出。',
          action: async () => {
            await frameEval(`document.querySelector('[data-sync-analytics]').click()`);
            let active;
            for (let i = 0; i < 60; i++) {
              active = await app('window.__IPOLLOWORK_ELECTRON__.browser.getState()');
              if (active.activeTabId === selectedTab.id) break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            ctx.assert(active.activeTabId === selectedTab.id, 'Sync did not select the stored account profile.');
          },
          assert: async () => {
            const actual = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: selectedTab.id }) + ')');
            const retained = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: otherTab.id }) + ')');
            ctx.assert(actual.tree.includes(account.expectedProfileId) && actual.tree.includes(account.handle), 'Sync targeted the wrong visible account.');
            ctx.assert(retained.tree.includes(other.expectedProfileId), 'Sync changed the other account login.');
            await ctx.output('observed-account-targets', JSON.stringify({ selected: { tabId: selectedTab.id, profileId: account.browserProfileId, name: account.handle, number: account.expectedProfileId }, retained: { tabId: otherTab.id, number: other.expectedProfileId } }, null, 2));
            await app(`document.querySelector('[aria-label="Select tab: 小红书运营台"]').click()`);
            await ctx.waitFor('Boolean(document.querySelector(\'[aria-label="Select tab: 小红书运营台"]\'))');
          },
          screenshot: { name: 'selected-account-sync', requireText: ['小红书运营台'] },
        });
      } finally {
        frame?.close();
        desktop.close();
      }
    },
  }],
};
