import { connect, listTargets } from '../runner/cdp.mjs';

export default {
  id: 'xiaohongshu-verification',
  title: '小红书登录后自动连接账号',
  kind: 'user-facing',
  steps: [{
    name: '打开创作台并返回后自动连接，无需 AI 验证任务',
    async run(ctx) {
      const origin = 'http://127.0.0.1:4790';
      const state = async () => JSON.parse((await (await fetch(origin + '/api/state')).json()).state);
      const openWorkbench = async () => {
        await ctx.eval(`document.querySelector('button[aria-label="Select tab: 小红书运营台"]').click()`);
        await ctx.waitFor(`Boolean(document.querySelector('iframe[title="小红书运营台"]'))`);
      };
      const frameEval = async expression => {
        let target;
        for (let i = 0; i < 40; i++) {
          target = (await listTargets(ctx.cdpBaseUrl)).find(t => t.type === 'iframe' && t.url.startsWith(origin));
          if (target) break;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        ctx.assert(Boolean(target), 'Installed workbench iframe is unavailable.');
        const client = await connect(target.webSocketDebuggerUrl);
        try {
          const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
          return result.result.value;
        } finally { client.close(); }
      };
      await openWorkbench();
      await frameEval(`location.href='/accounts'`);
      for (let i = 0; i < 40; i++) {
        if (await frameEval(`Boolean(document.querySelector('[data-account-login]'))`)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await frameEval(`document.querySelector('[data-account-login]').click()`);
      await ctx.waitFor(`(async()=>{const s=await window.__IPOLLOWORK_ELECTRON__.browser.getState();return s.tabs?.some(t=>t.id===s.activeTabId&&t.status==='ready'&&t.url==='https://creator.xiaohongshu.com/new/home')})()`, { timeoutMs: 30_000 });
      let identity;
      for (let i = 0; i < 30; i++) {
        identity = await ctx.eval(`(async()=>{const b=window.__IPOLLOWORK_ELECTRON__.browser;const s=await b.getState();return (await b.snapshot({tabId:s.activeTabId})).tree})()`, { awaitPromise: true });
        if (identity?.includes('小红书账号: 558869510')) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      ctx.assert(identity?.includes('小红书账号: 558869510'), 'The real platform login is unavailable; sign in before running this proof.');
      const before = await state();
      // Reversible fixture: make the existing account need connection, never mark it healthy here.
      const reset = await fetch(origin + '/api/accounts/1/session', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'setup' }),
      });
      ctx.assert(reset.ok, 'Could not prepare the disconnected account fixture.');
      await ctx.prove('登录账号后返回运营台，自动显示已连接并允许安排任务', {
        voiceover: '在软件内打开创作台并登录，返回运营台后会自动识别当前账号，无需再点击验证，也不会向左侧对话发送验证任务。',
        action: async () => {
          await openWorkbench();
          for (let i = 0; i < 50; i++) {
            if ((await state()).accounts.find(a => a[0] === 1)?.[1] === 'healthy') break;
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          await frameEval(`location.href='/accounts'`);
          for (let i = 0; i < 40; i++) {
            if (await frameEval(`location.pathname==='/accounts'&&document.body?.innerText.includes('可以安排任务')`)) break;
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        },
        assert: async () => {
          const saved = await state();
          ctx.assert(saved.accounts.find(a => a[0] === 1)?.[1] === 'healthy', 'Login did not automatically connect the account.');
          ctx.assert(JSON.stringify(saved.jobs) === JSON.stringify(before.jobs), 'Automatic login unexpectedly created or changed an AI job.');
          ctx.assert(JSON.stringify(saved.campaigns) === JSON.stringify(before.campaigns), 'Automatic login changed content scheduling.');
          const visible = await frameEval(`({text:document.body.innerText,manual:Boolean(document.querySelector('[data-verify-account]'))})`);
          ctx.assert(!visible.manual && visible.text.includes('自动连接') && visible.text.includes('可以安排任务'), 'Account UI still requires manual verification.');
        },
        screenshot: 'login-auto-connected',
      });
    },
  }],
};
