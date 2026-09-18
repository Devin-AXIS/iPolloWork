import { connect, evaluate, listTargets } from '../run.mjs';

export default {
  id: 'xiaohongshu-unicode-draft',
  title: '隐藏过程工具失败，并完整保存小红书中文草稿',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['XHS_EVAL_SESSION_HASH', 'XHS_EVAL_DRAFT_ID', 'XHS_EVAL_ACCOUNT_ID'],
  steps: [{
    name: '核对过程显示和中文草稿保存',
    async run(ctx) {
      const accountId = Number(process.env.XHS_EVAL_ACCOUNT_ID);
      const draftId = process.env.XHS_EVAL_DRAFT_ID;
      await ctx.navigateHash(process.env.XHS_EVAL_SESSION_HASH);
      await ctx.waitFor(`Boolean(document.querySelector('[aria-label="展开处理过程"]'))`);
      await ctx.prove('展开处理过程时不再显示工具失败行，最终回答仍保留', {
        voiceover: '展开处理过程，界面保留执行进展和最终回答，不再显示每次工具尝试失败的红色提示。',
        action: async () => {
          await ctx.eval(`(() => { const buttons = [...document.querySelectorAll('[aria-label="展开处理过程"],[aria-label="收起处理过程"]')]; const button = buttons.at(-1); if (button.getAttribute('aria-expanded') !== 'true') button.click(); button.scrollIntoView({block:'center'}); })()`);
        },
        assert: async () => {
          const state = await ctx.eval(`(() => { const group = [...document.querySelectorAll('[data-testid="assistant-message-group"]')].findLast(g=>g.querySelector('[aria-label="收起处理过程"]')); return { found: Boolean(group), failed: group ? [...group.querySelectorAll('button,span')].filter(e=>e.textContent.trim()==='failed').length : -1, tools: group?.querySelectorAll('[data-message-id]').length ?? 0 }; })()`);
          ctx.assert(state.found && state.tools > 0 && state.failed === 0, 'Expanded progress still exposes failed tool attempts.');
          ctx.assert(await ctx.eval(`Boolean(document.querySelector('[aria-label="保存为 Markdown"]'))`), 'The final response was hidden.');
        },
        screenshot: { name: 'quiet-tool-progress', requireText: ['小红书'] },
      });
      let frame;
      try {
        await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]').click()`);
        await ctx.waitFor(`Boolean(document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]'))`);
        await ctx.eval(`document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]').click()`);
        let target;
        for (let i = 0; i < 60; i++) {
          target = (await listTargets(ctx.cdpBaseUrl)).find(t => t.type === 'iframe' && t.url.startsWith('http://127.0.0.1:4790'));
          if (target) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        ctx.assert(target, 'The installed workbench did not open.');
        frame = await connect(target.webSocketDebuggerUrl);
        const ui = expression => evaluate(frame, expression, { awaitPromise: true });
        const wait = async expression => {
          for (let i = 0; i < 60; i++) {
            if (await ui(expression).catch(() => false)) return;
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          throw new Error('Workbench did not reach: ' + expression);
        };
        await frame.send('Page.navigate', { url: `http://127.0.0.1:4790/publishing?account=${accountId}&draft=${encodeURIComponent(draftId)}` });
        await wait(`Boolean(document.querySelector('#post-draft-form')) && document.readyState === 'complete'`);
        const before = await ui(`JSON.parse(document.querySelector('#page-data').textContent).draft`);
        ctx.assert(before.id === draftId && /[\u4e00-\u9fff]/.test(before.title) && !/\?{4,}/.test(before.body), 'Use the recovered Unicode draft.');
        await ctx.prove('中文标题、描述与创作要求保存后保持完整，素材仍在', {
          voiceover: '回到发帖面板，原来的中文标题、描述和创作要求已经恢复。再次保存后，文字和三张素材仍然完整。',
          action: async () => {
            await ui(`document.querySelector('#post-draft-form button[type="submit"]').click()`);
            await wait(`Boolean(document.querySelector('#post-draft-form')) && document.readyState === 'complete' && JSON.parse(document.querySelector('#page-data').textContent).draft.updatedAt !== ${JSON.stringify(before.updatedAt)}`);
            await ctx.eval(`document.querySelector('[aria-label="Select tab: 小红书运营台"]').click()`);
            await new Promise(resolve => setTimeout(resolve, 500));
          },
          assert: async () => {
            const after = await ui(`({draft:JSON.parse(document.querySelector('#page-data').textContent).draft, title:document.querySelector('[name="title"]').value, body:document.querySelector('[name="body"]').value, preview:document.querySelector('[data-preview-title]').textContent})`);
            for (const key of ['name', 'title', 'body', 'brief', 'topics', 'mediaKind', 'assetIds']) ctx.assert(JSON.stringify(after.draft[key]) === JSON.stringify(before[key]), `Save changed ${key}.`);
            ctx.assert(after.title === before.title && after.body === before.body && after.preview === before.title, 'The UI does not match the persisted Unicode data.');
            ctx.assert(after.draft.updatedAt !== before.updatedAt, 'The save action did not persist the draft.');
            await ctx.output('unicode-save', JSON.stringify({ draftId, accountId, title: after.title, fieldsVerified: ['name', 'brief', 'title', 'body', 'topics', 'mediaKind', 'assetIds'], assets: before.assetIds.length }));
          },
          screenshot: { name: 'unicode-draft-preserved', fromSurface: false, textTargetId: target.id, requireText: [before.title, 'AI 写标题和描述'] },
        });
      } finally { frame?.close(); }
    },
  }],
};
