import {connect, evaluate, listTargets} from '../run.mjs';

export default {
  id: 'xiaohongshu-search-resume', title: '扫码后继续搜索并回写真实帖子', kind: 'user-facing', preserveTheme: true,
  requiredEnv: ['XHS_EVAL_SESSION_HASH', 'XHS_EVAL_SEARCH_ID', 'XHS_EVAL_ACCOUNT_ID'],
  steps: [{name: '继续登录阻塞的搜索', async run(ctx) {
    const accountId = Number(process.env.XHS_EVAL_ACCOUNT_ID), searchId = process.env.XHS_EVAL_SEARCH_ID;
    const wait = async (operation, label, attempts = 80, interval = 250) => {
      for (let i = 0; i < attempts; i++) { if (await operation()) return; await new Promise(resolve => setTimeout(resolve, interval)); }
      throw new Error(label);
    };
    await ctx.navigateHash(process.env.XHS_EVAL_SESSION_HASH);
    await ctx.waitFor(`Boolean(document.querySelector('[aria-label="打开右侧面板"]') || document.querySelector('[aria-label="添加侧面板入口"]'))`);
    await ctx.eval(`document.querySelector('[aria-label="打开右侧面板"]')?.click()`);
    await ctx.waitFor(`Boolean(document.querySelector('[aria-label="添加侧面板入口"]'))`);
    const entry = '[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]';
    await ctx.eval(`if (!document.querySelector(${JSON.stringify(entry)})) document.querySelector('[aria-label="添加侧面板入口"]').click()`);
    await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(entry)}))`);
    await ctx.eval(`document.querySelector(${JSON.stringify(entry)}).click()`);
    let target;
    await wait(async () => { target = (await listTargets(ctx.cdpBaseUrl)).find(t => t.type === 'iframe' && t.url.startsWith('http://127.0.0.1:4790/')); return Boolean(target); }, 'Installed workbench not found');
    const client = await connect(target.webSocketDebuggerUrl);
    const ui = expression => evaluate(client, expression, {awaitPromise: true});
    const url = `http://127.0.0.1:4790/comments?account=${accountId}&search=${encodeURIComponent(searchId)}`;
    const read = () => ui(`fetch('/api/studio/studio-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:${accountId},searchId:${JSON.stringify(searchId)}})}).then(r=>r.json())`);
    try {
      await client.send('Page.navigate', {url});
      await wait(() => ui(`Boolean(document.querySelector('#post-search-form')) && document.readyState === 'complete'`).catch(()=>false), 'Search form not loaded');
      const before = (await read()).searches.find(item => item.id === searchId);
      let saved;
      await ctx.prove('登录后继续原搜索，真实帖子回到评论面板', {
        voiceover: '扫码完成后点继续搜索，原来的关键词和排序保留下来，真实帖子会显示在列表中。',
        action: async () => {
          ctx.assert(['waiting_login', 'failed'].includes(before.status), 'Use an existing interrupted search');
          ctx.assert(await ui(`Boolean(document.querySelector('[data-studio-action="resume-search"]'))`), 'Recovery button missing');
          await ui(`document.querySelector('[data-studio-action="resume-search"]').click()`);
          await wait(async () => {
            const state = await read().catch(()=>null);
            saved = state?.searches.find(item => item.id === searchId);
            if (saved?.status === 'waiting_login' && saved.updatedAt > before.updatedAt) throw new Error('The selected web profile still requires the user to sign in');
            if (saved?.status === 'failed' && saved.updatedAt > before.updatedAt) throw new Error(saved.error);
            return saved?.status === 'ready';
          }, 'AI did not return search results within four minutes', 80, 3000);
          // Select the workbench again after the worker has opened the search browser tab.
          await ctx.eval(`if (!document.querySelector(${JSON.stringify(entry)})) document.querySelector('[aria-label="添加侧面板入口"]').click()`);
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(entry)}))`);
          await ctx.eval(`document.querySelector(${JSON.stringify(entry)}).click()`);
          await client.send('Page.navigate', {url});
          await wait(() => ui(`document.querySelectorAll('[data-post-id]').length > 0`).catch(()=>false), 'Saved candidates not rendered');
          await ui(`document.querySelector('.search-results').scrollIntoView({block:'start'})`);
        },
        assert: async () => {
          for (const key of ['id', 'accountId', 'query', 'sort', 'limit', 'exclude', 'instruction']) ctx.assert(saved[key] === before[key], 'Search configuration changed: ' + key);
          ctx.assert(saved.results.length > 0 && saved.results.every(item => !item.jobId && !item.selected && item.url && item.title), 'Expected real, unselected candidates without comment jobs');
          ctx.assert(await ui(`!document.querySelector('[data-studio-action="resume-search"]')`), 'Stale login error remains');
          await ctx.output('resumed-search', JSON.stringify({id:searchId,query:saved.query,status:saved.status,count:saved.results.length,titles:saved.results.map(item=>item.title)}));
        },
        screenshot: {name:'search-results-returned',fromSurface:false,textTargetId:target.id,requireText:['相关帖子','户外露营'],rejectText:['扫码完成，继续搜索']},
      });
    } finally { client.close(); }
  }}],
};
