import { connect, evaluate, listTargets } from '../runner/cdp.mjs';

export default {
  id: 'xiaohongshu-workbench-session',
  title: '新会话编辑小红书草稿时保持可用，切换账号自动保存',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['XHS_EVAL_SESSION_HASH', 'XHS_OPS_ORIGIN'],
  steps: [{
    name: '保留未开始的会话，并保存切换账号前的草稿',
    async run(ctx) {
      const origin = process.env.XHS_OPS_ORIGIN;
      let frame;
      try {
        await ctx.navigateHash(process.env.XHS_EVAL_SESSION_HASH);
        await ctx.waitFor(`!document.body.innerText.includes('Workspace or session not found') && Boolean(document.querySelector('[contenteditable="true"],textarea'))`);
        if (!await ctx.eval(`Boolean(document.querySelector('[aria-label="Select tab: 小红书运营台"]'))`)) {
          await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]').click()`);
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]'))`);
          await ctx.eval(`document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]').click()`);
        } else await ctx.eval(`document.querySelector('[aria-label="Select tab: 小红书运营台"]').click()`);
        let target;
        for (let i = 0; i < 40; i++) {
          target = (await listTargets(ctx.cdpBaseUrl)).find(t => t.type === 'iframe' && t.url.startsWith(origin));
          if (target) break;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        ctx.assert(target, 'The real workbench did not open.');
        frame = await connect(target.webSocketDebuggerUrl);
        const ui = expression => evaluate(frame, expression, { awaitPromise: true });
        const wait = async expression => {
          for (let i = 0; i < 60; i++) {
            if (await ui(expression).catch(() => false)) return;
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          throw new Error('Workbench did not reach: ' + expression);
        };
        await frame.send('Page.navigate', { url: origin + '/publishing?account=2' });
        await wait(`document.readyState === 'complete' && Boolean(document.querySelector('#post-draft-form'))`);
        const before = await ui(`({ fields: Object.fromEntries(new FormData(document.querySelector('#post-draft-form'))), data: JSON.parse(document.querySelector('#page-data').textContent) })`);
        ctx.assert(before.data.draft?.id && before.data.accounts.length > 1, 'Use an existing saved draft with two bound accounts.');
        await ctx.prove('在新会话的运营台编辑超过 30 秒，对话框仍保持可用', {
          voiceover: '在新会话里填写小红书草稿，等待会话列表刷新，对话框仍然正常，不再提示会话不存在。',
          action: async () => {
            await ui(`const field = document.querySelector('[name="brief"]'); field.focus(); field.dispatchEvent(new Event('input', { bubbles: true }));`);
            await new Promise(resolve => setTimeout(resolve, 35_000));
          },
          assert: async () => {
            ctx.assert(!await ctx.eval(`document.body.innerText.includes('Workspace or session not found')`), 'The selected unstarted session disappeared after the refresh.');
            ctx.assert(await ctx.eval(`Boolean(document.querySelector('[contenteditable="true"],textarea'))`), 'The conversation composer is unavailable.');
            ctx.assert(await ui(`document.querySelector('[name="brief"]').value`) === before.fields.brief, 'Editing lost the brief.');
          },
          screenshot: { name: 'unstarted-session-remains-available', requireText: ['小红书运营台'] },
        });
        await ctx.prove('切换账号自动保存当前草稿，切回来内容保持完整', {
          voiceover: '展开账号列表并切换，软件自动保存当前草稿；再切回来，刚才填写的内容还在。',
          action: async () => {
            await ui(`document.querySelector('.account-picker summary').click(); document.querySelector('.account-menu a[href="/publishing?account=1"]').click();`);
            await wait(`location.search.includes('account=1') && document.readyState === 'complete' && Boolean(document.querySelector('.account-picker'))`);
            await ui(`document.querySelector('.account-picker summary').click(); document.querySelector('.account-menu a[href="/publishing?account=2"]').click();`);
            await wait(`location.search.includes('account=2') && document.readyState === 'complete' && Boolean(document.querySelector('#post-draft-form'))`);
          },
          assert: async () => {
            const after = await ui(`({fields: Object.fromEntries(new FormData(document.querySelector('#post-draft-form'))), draft: JSON.parse(document.querySelector('#page-data').textContent).draft})`);
            ctx.assert(JSON.stringify(after.fields) === JSON.stringify(before.fields), 'Account switching lost or changed the draft fields.');
            ctx.assert(after.draft.id === before.data.draft.id && after.draft.updatedAt !== before.data.draft.updatedAt, 'Account switching did not persist the original draft.');
            ctx.assert(!await ctx.eval(`document.body.innerText.includes('Workspace or session not found')`), 'Switching accounts invalidated the conversation.');
            await ctx.output('saved-draft', JSON.stringify({ accountId: 2, draftId: after.draft.id, updatedAt: after.draft.updatedAt, name: after.fields.name, brief: after.fields.brief }, null, 2));
          },
          screenshot: { name: 'account-switch-preserves-draft', requireText: ['小红书运营台'] },
        });
      } finally { frame?.close(); }
    },
  }],
};
