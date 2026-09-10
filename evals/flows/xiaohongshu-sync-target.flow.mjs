import { connect, evaluate, listTargets } from '../runner/cdp.mjs';
import { DatabaseSync } from 'node:sqlite';

const origin = process.env.XHS_OPS_ORIGIN;
const desktopCdp = process.env.IPOLLOWORK_APP_CDP_URL;
const accountId = Number(process.env.XHS_OPS_PROOF_ACCOUNT_ID);

export default {
  id: 'xiaohongshu-sync-target',
  title: '换到当前会话仍能同步所选账号，另一个账号保持登录',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['XHS_OPS_ORIGIN', 'IPOLLOWORK_APP_CDP_URL', 'XHS_OPS_PROOF_ACCOUNT_ID', 'XHS_OPS_PROOF_DB_PATH'],
  steps: [{
    name: '从实际运营台点击同步并核对两个账号的可见身份',
    async run(ctx) {
      const target = (await listTargets(desktopCdp)).find(t => t.type === 'page' && t.url.includes('localhost:5173'));
      const desktop = await connect(target.webSocketDebuggerUrl);
      const app = expression => evaluate(desktop, expression, { awaitPromise: true });
      const db = new DatabaseSync(process.env.XHS_OPS_PROOF_DB_PATH, { readOnly: true });
      let frame;
      try {
        const sessionId = await app(`location.hash.split('/session/')[1]`);
        const binding = db.prepare('SELECT worker_thread_id FROM accounts WHERE id = ?').get(accountId);
        ctx.assert(binding?.worker_thread_id && binding.worker_thread_id !== sessionId, 'Run from a different session than the account worker to reproduce the reported error.');
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
        await app('window.__IPOLLOWORK_ELECTRON__.browser.openUrl(' + JSON.stringify(other.profileUrl) + ', ' + JSON.stringify({ profileId: other.browserProfileId }) + ')');
        const state = await app('window.__IPOLLOWORK_ELECTRON__.browser.getState()');
        const otherTab = state.tabs.find(t => t.profileId === other.browserProfileId);
        ctx.assert(otherTab, 'The other account browser tab did not open.');
        let otherBefore;
        for (let i = 0; i < 20; i++) {
          otherBefore = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: otherTab.id }) + ')');
          if (otherBefore.tree.includes(other.expectedProfileId)) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        ctx.assert(otherBefore.tree.includes(other.expectedProfileId), 'The other logged-in account identity was not visible.');
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
        // Record the real host acknowledgement across the workbench's reload.
        const marker = 'xhs-sync-proof-' + Date.now();
        await app(`window.__xhsSyncProofAccepted = false; window.__xhsSyncProofListener = event => {
          if (event.data?.marker === ${JSON.stringify(marker)} && event.data.accepted) window.__xhsSyncProofAccepted = true;
        }; window.addEventListener('message', window.__xhsSyncProofListener);`);
        await frameEval(`window.addEventListener('message', event => {
          if (event.source === parent && event.data?.jsonrpc === '2.0' && event.data.id === 2 && !event.data.method) {
            parent.postMessage({ marker: ${JSON.stringify(marker)}, accepted: !event.data.error && !event.data.result?.isError }, '*');
          }
        });`);
        let selectedTab;
        let syncJob;
        await ctx.prove('在当前会话点击同步成功发起或继续任务并打开所选账号，无需返回旧会话', {
          voiceover: '换到当前会话后，点击同步数据就能打开所选账号并开始同步，另一个账号保持登录。',
          action: async () => {
            await frameEval(`document.querySelector('[data-sync-analytics]').click()`);
            let active;
            for (let i = 0; i < 60; i++) {
              active = await app('window.__IPOLLOWORK_ELECTRON__.browser.getState()');
              selectedTab = active.tabs.find(t => t.profileId === account.browserProfileId);
              syncJob = db.prepare("SELECT id, status, worker_thread_id, payload_json FROM browser_jobs WHERE account_id = ? AND type = 'verify_session' ORDER BY created_at DESC LIMIT 1").get(accountId);
              if (selectedTab && active.activeTabId === selectedTab.id && syncJob?.worker_thread_id === sessionId) break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            ctx.assert(selectedTab && active.activeTabId === selectedTab.id, 'Sync did not select the stored account profile.');
            ctx.assert(syncJob?.worker_thread_id === sessionId && ['dispatched', 'running', 'succeeded'].includes(syncJob.status), 'Sync was not assigned to the current session.');
            ctx.assert(JSON.parse(syncJob.payload_json).browserProfileId === account.browserProfileId, 'Sync job did not retain the selected browser profile.');
            let received = false;
            for (let i = 0; i < 40; i++) {
              received = await app('window.__xhsSyncProofAccepted === true');
              if (received) break;
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            ctx.assert(received, 'The current conversation rejected the sync task after clicking.');
          },
          assert: async () => {
            let actual;
            const page = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: selectedTab.id }) + ')');
            if (!page.tree.includes(account.expectedProfileId)) {
              const home = page.tree.split('\n').find(line => line.includes('button "首页"'));
              ctx.assert(home, 'Open the creator home page to verify the selected account identity.');
              await app('window.__IPOLLOWORK_ELECTRON__.browser.act(' + JSON.stringify({ tabId: selectedTab.id, snapshotId: page.snapshotId, actions: [{ type: 'click', ref: home.trim().split(']')[0].slice(1), expectedName: '首页' }] }) + ')');
            }
            for (let i = 0; i < 20; i++) {
              actual = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: selectedTab.id }) + ')');
              if (actual.tree.includes(account.expectedProfileId)) break;
              await new Promise(resolve => setTimeout(resolve, 300));
            }
            const retained = await app('window.__IPOLLOWORK_ELECTRON__.browser.snapshot(' + JSON.stringify({ tabId: otherTab.id }) + ')');
            ctx.assert(actual.tree.includes(account.expectedProfileId) && actual.tree.includes(account.handle), 'Sync targeted the wrong visible account.');
            ctx.assert(retained.tree.includes(other.expectedProfileId), 'Sync changed the other account login.');
            ctx.assert(db.prepare('SELECT worker_thread_id FROM accounts WHERE id = ?').get(accountId).worker_thread_id === binding.worker_thread_id, 'Sync changed the permanent account binding.');
            await ctx.output('observed-account-targets', JSON.stringify({ sessionId, previousBinding: binding.worker_thread_id, jobId: syncJob.id, jobStatus: syncJob.status, selected: { tabId: selectedTab.id, profileId: account.browserProfileId, name: account.handle, number: account.expectedProfileId }, retained: { tabId: otherTab.id, number: other.expectedProfileId } }, null, 2));
            await app(`document.querySelector('[aria-label="Select tab: 小红书运营台"]').click()`);
            await ctx.waitFor('Boolean(document.querySelector(\'[aria-label="Select tab: 小红书运营台"]\'))');
          },
          screenshot: { name: 'selected-account-sync', requireText: ['小红书运营台'] },
        });
      } finally {
        await app(`if (window.__xhsSyncProofListener) window.removeEventListener('message', window.__xhsSyncProofListener); delete window.__xhsSyncProofListener; delete window.__xhsSyncProofAccepted;`).catch(() => {});
        frame?.close();
        desktop.close();
        db.close();
      }
    },
  }],
};
