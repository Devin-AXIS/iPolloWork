import {connect, evaluate, listTargets} from '../run.mjs';

export default {
  id: 'xiaohongshu-regenerate-text', title: '按当前要求替换旧草稿文案', kind: 'user-facing', preserveTheme: true,
  requiredEnv: ['XHS_EVAL_SESSION_HASH', 'XHS_EVAL_DRAFT_ID', 'XHS_EVAL_ACCOUNT_ID'],
  steps: [{name: '按当前露营车要求重新生成草稿文案', async run(ctx) {
    const accountId = Number(process.env.XHS_EVAL_ACCOUNT_ID), draftId = process.env.XHS_EVAL_DRAFT_ID;
    await ctx.client.send('Page.bringToFront');
    await ctx.navigateHash(process.env.XHS_EVAL_SESSION_HASH);
    await ctx.waitFor(`Boolean(document.querySelector('[aria-label="打开右侧面板"]') || document.querySelector('[aria-label="添加侧面板入口"]'))`);
    await ctx.eval(`document.querySelector('[aria-label="打开右侧面板"]')?.click()`);
    await ctx.waitFor(`Boolean(document.querySelector('[aria-label="添加侧面板入口"]'))`);
    await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]').click()`);
    const entry = '[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]';
    await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(entry)}))`);
    await ctx.eval(`document.querySelector(${JSON.stringify(entry)}).click()`);
    const wait = async (operation, message, attempts = 80, interval = 250) => {
      for (let i = 0; i < attempts; i++) { if (await operation()) return; await new Promise(resolve => setTimeout(resolve, interval)); }
      throw new Error(message);
    };
    let target;
    await wait(async () => { target = (await listTargets(ctx.cdpBaseUrl)).find(t => t.type === 'iframe' && t.url.startsWith('http://127.0.0.1:4790/')); return Boolean(target); }, 'Installed workbench not found');
    const client = await connect(target.webSocketDebuggerUrl);
    const ui = expression => evaluate(client, expression, {awaitPromise: true});
    try {
      await client.send('Page.navigate', {url: `http://127.0.0.1:4790/publishing?account=${accountId}&draft=${encodeURIComponent(draftId)}`});
      await wait(() => ui(`Boolean(document.querySelector('#post-draft-form')) && document.readyState === 'complete'`).catch(() => false), 'Draft form not loaded');
      const before = await ui(`JSON.parse(document.querySelector('#page-data').textContent).draft`);
      ctx.assert(before.id === draftId && /露营车/.test(before.brief), 'Use the user draft whose current requirement is a camper van');
      ctx.assert(Boolean(before.title && before.body), 'The old draft must have copy before regeneration');
      let cleared;
      await ctx.prove('点击 AI 后旧标题、描述、话题被清空，只提交当前预设和要求', {
        voiceover: '点击 AI 写标题和描述，旧文案立即清空，这次只按当前的露营车要求重新创作。',
        action: async () => {
          await ui(`(() => {
            const original = window.fetch;
            window.__regenerationRequests = [];
            window.__restoreRegenerationFetch = () => { window.fetch = original; };
            window.fetch = async (...args) => {
              const url = String(args[0]);
              const item = url.includes('/api/studio/') ? {url, input:JSON.parse(args[1].body)} : null;
              if (item) window.__regenerationRequests.push(item);
              const response = await original(...args);
              if (item) { item.status = response.status; item.result = await response.clone().json(); }
              return response;
            };
            document.querySelector('[data-studio-action="draft"]').click();
          })()`);
          await wait(() => ui(`Boolean(window.__regenerationRequests?.some(item=>item.url.endsWith('/request-action') && item.status===200))`), 'Regeneration request did not finish');
          await wait(() => ui(`!document.querySelector('[data-studio-action="draft"]').disabled`), 'Host did not accept the AI message');
          // Allow the embedded view to repaint after the host accepts the message.
          // Animation-frame promises can stall when Electron is in the background.
          await new Promise(resolve => setTimeout(resolve, 1000));
          cleared = await ui(`({requests:window.__regenerationRequests, title:document.querySelector('[name="title"]').value, body:document.querySelector('[name="body"]').value, topics:document.querySelector('[name="topics"]').value})`);
        },
        assert: async () => {
          ctx.assert(cleared.title === '' && cleared.body === '' && cleared.topics === '', 'Old copy remains in the form');
          const request = cleared.requests.find(item => item.url.endsWith('/request-action'));
          ctx.assert(!cleared.requests.some(item => item.url.endsWith('/save-post-draft')), 'The button saved old copy before regenerating');
          for (const field of ['title', 'body', 'topics']) ctx.assert(!(field in request.input), 'Old copy entered the generation request: ' + field);
          ctx.assert(request.input.name === before.name && request.input.brief === before.brief, 'Current preset and brief were not submitted');
          ctx.assert(!request.result.prompt.includes(before.title) && !request.result.prompt.includes(before.body), 'Old copy leaked into the AI prompt');
          ctx.assert(request.result.draft.title === '' && request.result.draft.body === '' && request.result.draft.topics.length === 0, 'Old persisted copy was not cleared');
          await ctx.output('regeneration-input', JSON.stringify({name:request.input.name, brief:request.input.brief, cleared:true, oldCopyExcluded:true}));
        },
        screenshot: {name:'old-copy-cleared', fromSurface:false, textTargetId:target.id, requireText:['AI 写标题和描述','你的帖子标题']},
      });
      await ui('window.__restoreRegenerationFetch?.();');
      let generated;
      await ctx.prove('AI 生成露营车的新文案并回写当前草稿', {
        voiceover: '生成完成后，标题、描述和话题都围绕露营车，重新打开后仍然是这次的新内容。',
        action: async () => {
          await wait(async () => {
            const state = await ui(`fetch('/api/studio/studio-state', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({accountId:${accountId},draftId:${JSON.stringify(draftId)}})}).then(response=>response.json())`);
            generated = state.drafts?.find(draft => draft.id === draftId);
            const request = cleared.requests.find(item => item.url.endsWith('/request-action'));
            return Boolean(generated?.title && generated?.body && generated.updatedAt > request.result.draft.updatedAt);
          }, 'The real AI did not save new copy within four minutes', 80, 3000);
          await client.send('Page.navigate', {url:`http://127.0.0.1:4790/publishing?account=${accountId}&draft=${encodeURIComponent(draftId)}`});
          await wait(() => ui(`Boolean(document.querySelector('[name="title"]')) && document.querySelector('[name="title"]').value === ${JSON.stringify(generated.title)}`).catch(()=>false), 'Saved result not displayed');
        },
        assert: async () => {
          ctx.assert(/露营|营地/.test(generated.title + generated.body) && /车/.test(generated.title + generated.body), 'New copy is not about the requested camper van');
          ctx.assert(!/影像旗舰|主摄|夜景模式/.test(generated.title + generated.body), 'Old phone content survived regeneration');
          ctx.assert(generated.name === before.name && generated.brief === before.brief, 'Generation modified its source requirements');
          ctx.assert(generated.status === 'draft' && !generated.jobId, 'The action started publishing');
          ctx.assert(JSON.stringify(generated.assetIds) === JSON.stringify(before.assetIds), 'Text generation altered media attachments');
          await ctx.output('generated-copy', JSON.stringify({title:generated.title, body:generated.body, topics:generated.topics, status:generated.status}));
        },
        screenshot: {name:'camper-copy-saved', fromSurface:false, textTargetId:target.id, requireText:['AI 写标题和描述','露营']},
      });
    } finally {
      await ui('window.__restoreRegenerationFetch?.();').catch(() => undefined);
      client.close();
    }
  }}],
};
