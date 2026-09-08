import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('image-studio-session-outputs');
const studioDocument = `document.querySelector('iframe[title="图片工作台"]')?.contentDocument`;

function apiExpression(workspaceId, suffix, mode = 'json') {
  return `(async () => {
    const server = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
    const response = await fetch(server.baseUrl + ${JSON.stringify(`/workspace/${encodeURIComponent(workspaceId)}${suffix}`)}, {
      headers: {authorization:'Bearer ' + (server.ownerToken || server.clientToken), 'X-iPolloWork-Host-Token':server.hostToken},
    });
    if (!response.ok) throw new Error('Artifact check HTTP ' + response.status);
    ${mode === 'hash' ? `const bytes = await response.arrayBuffer(); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');` : 'return response.json();'}
  })()`;
}

const api = (ctx, workspaceId, suffix, mode) => ctx.eval(apiExpression(workspaceId, suffix, mode), {awaitPromise:true});

async function showWindow(ctx) {
  await ctx.client.send('Page.bringToFront');
}

async function openOutputs(ctx) {
  await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="' + location.hash.split('/').pop() + '"]'))`);
  if (!await ctx.eval(`document.querySelector('button[aria-label="产出文件"]')?.getAttribute('aria-pressed') === 'true'`)) {
    await ctx.eval(`document.querySelector('button[aria-label="产出文件"]').click()`);
  }
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="conversation-files-outputs-view"]'))`);
}

function cardExpression(path) {
  return `Array.from(document.querySelectorAll('[data-testid="conversation-files-outputs-view"] [data-testid="artifact-file-card"]')).find(card => Array.from(card.querySelectorAll('[title]')).some(node => node.title === ${JSON.stringify(path.split('/').pop())}))`;
}

async function expectCard(ctx, path) {
  await ctx.waitFor(`Boolean(${cardExpression(path)}?.getClientRects().length)`, {label:`visible output card for ${path}`});
  ctx.assert(await ctx.eval(`Boolean(${cardExpression(path)})`), `Output card must identify ${path}`);
}

async function openImageCard(ctx, path) {
  if (await ctx.eval(`Boolean(document.querySelector('iframe[title="图片工作台"]'))`)) {
    await ctx.waitFor(`window.__ipolloworkControl?.listActions().some(action => action.id === 'workspace_app.list_tools' && !action.disabled)`, {timeoutMs:30000,label:'restored Image Studio bridge ready'});
    await ctx.waitFor(`${studioDocument}?.querySelector('#busyLayer')?.classList.contains('visible') === false`, {timeoutMs:30000,label:'restored image finished loading'});
  }
  await expectCard(ctx, path);
  await ctx.eval(`${cardExpression(path)}.click()`);
  await ctx.waitFor(`${studioDocument}?.querySelector('#sourceMeta')?.textContent.includes(${JSON.stringify(path.split('/').pop())})`, {label:'selected output decoded in Image Studio'});
  ctx.assert(await ctx.eval(`${studioDocument}.querySelector('#imageCanvas').width > 100`), 'The saved output must decode into a real image');
  await openOutputs(ctx);
}

async function closeOutputs(ctx) {
  if (await ctx.eval(`Boolean(document.querySelector('[data-testid="conversation-files-popover"]'))`)) {
    await ctx.eval(`document.querySelector('button[aria-label="产出文件"]').click()`);
    await ctx.waitFor(`!document.querySelector('[data-testid="conversation-files-popover"]')`);
  }
}

async function openStudio(ctx) {
  await ctx.waitFor(`Boolean(document.querySelector('iframe[title="图片工作台"]') || document.querySelector('button[aria-label="添加侧面板入口"]'))`);
  if (!await ctx.eval(`Boolean(document.querySelector('iframe[title="图片工作台"]'))`)) {
    await ctx.eval(`document.querySelector('button[aria-label="添加侧面板入口"]').click()`);
    await ctx.clickText('图片工作台', {selector:'[role="menuitem"],button'});
  }
  await ctx.waitFor(`Boolean(${studioDocument}?.querySelector('#generateMode'))`);
  if (!await ctx.eval(`Boolean(document.querySelector('textarea[name="prompt"]'))`)) {
    await ctx.eval(`Array.from(${studioDocument}.querySelectorAll('button')).find(b=>b.textContent.trim()==='参数').click()`);
  }
  await ctx.waitFor(`Boolean(document.querySelector('textarea[name="prompt"]'))`);
}

async function waitForNewOutput(ctx, workspaceId, sessionId, previousPaths) {
  const expression = apiExpression(workspaceId, `/artifacts?sessionId=${encodeURIComponent(sessionId)}`);
  for (let attempt = 0; attempt < 150; attempt++) {
    const page = await ctx.eval(expression, {awaitPromise:true});
    const next = page.items.find(item => !previousPaths.has(item.path));
    if (next) return next;
    const error = await ctx.eval(`Array.from(document.querySelectorAll('[role="status"]')).map(e=>e.innerText).find(text=>/失败|错误|error|failed|未返回/i.test(text)) || ''`);
    if (error) throw new Error(error);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Image provider did not save a session output within five minutes');
}

export default {
  id: 'image-studio-session-outputs',
  title: 'Image Studio outputs survive session switching and reopening without chat messages',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['IPOLLOWORK_EVAL_SESSION_ID','IPOLLOWORK_EVAL_OTHER_SESSION_ID','IPOLLOWORK_EVAL_WORKSPACE_ID'],
  steps: [{
    name: 'Generate, edit, switch sessions, and reopen saved outputs',
    async run(ctx) {
      const sessionId = ctx.env.IPOLLOWORK_EVAL_SESSION_ID;
      const otherId = ctx.env.IPOLLOWORK_EVAL_OTHER_SESSION_ID;
      const workspaceId = ctx.env.IPOLLOWORK_EVAL_WORKSPACE_ID;
      const route = `/workspace/${workspaceId}/session/${sessionId}`;
      const messagePath = `/sessions/${sessionId}/messages`;
      const listPath = `/artifacts?sessionId=${encodeURIComponent(sessionId)}`;
      await showWindow(ctx);
      await ctx.navigateHash(route);
      await ctx.waitFor('Boolean(window.__ipolloworkControl)');
      const beforeMessages = JSON.stringify(await api(ctx, workspaceId, messagePath));
      const before = await api(ctx, workspaceId, listPath);
      const previousPaths = new Set(before.items.map(item=>item.path));
      // Resume visual checks after a capture/assertion failure without buying more images.
      const reusePaths = ctx.env.IPOLLOWORK_EVAL_OUTPUT_PATHS?.split('|');
      const reuseGenerated = reusePaths ? before.items.find(item=>item.path === reusePaths[0]) : null;
      const reuseEdited = reusePaths ? before.items.find(item=>item.path === reusePaths[1]) : null;
      if (reusePaths) {
        ctx.assert(reuseGenerated && reuseEdited, 'Both resumed files must already be registered to this session');
        ctx.output('Proof continuation', `Reusing actual generated and edited outputs from an earlier run: ${reusePaths.join(', ')}`);
      }
      let generated;
      let edited;
      let originalHash;
      await ctx.prove('A workbench generation appears in this session output list', {
        voiceover: vo[0],
        action: async () => {
          await openStudio(ctx);
          if (reuseGenerated) {
            generated = reuseGenerated;
          } else {
            await ctx.eval(`${studioDocument}.querySelector('#generateMode').click()`);
            await ctx.trustedClick('[aria-label="图片模型"]');
            await ctx.clickText('GPT Image 2 · ChatGPT 登录', {selector:'[role="option"]'});
            await ctx.fill('textarea[name="prompt"]', '生成一张卡通风格后羿射日插画，暖金色天空，人物拉弓，简洁构图，不要文字。');
            await ctx.clickText('生成图片', {selector:'button'});
            generated = await waitForNewOutput(ctx, workspaceId, sessionId, previousPaths);
          }
          previousPaths.add(generated.path);
          originalHash = await api(ctx, workspaceId, `/files/raw?path=${encodeURIComponent(generated.path)}`, 'hash');
          await openOutputs(ctx);
          await expectCard(ctx, generated.path);
          if (reuseGenerated) await openImageCard(ctx, generated.path);
        },
        assert: async () => {
          ctx.assert(generated.size > 1000, 'Generated image must be a saved non-empty file');
          ctx.assert(JSON.stringify(await api(ctx, workspaceId, messagePath)) === beforeMessages, 'Generation must not insert a chat message');
          await expectCard(ctx, generated.path);
          ctx.output('Generated output', JSON.stringify(generated));
          await showWindow(ctx);
        },
        screenshot: {name:'generated-session-output',requireText:['产出','图片工作台']},
      });
      await closeOutputs(ctx);
      await ctx.prove('An edit preserves the original and remains owned by the initiating session', {
        voiceover: vo[1],
        action: async () => {
          if (!reuseEdited) {
            await ctx.waitFor(`${studioDocument}?.querySelector('#busyLayer')?.classList.contains('visible') === false`);
            await ctx.fill('textarea[name="prompt"]', '保持人物和构图，将背景的天空改为清新的蓝色，保持卡通风格，不要文字。');
            await ctx.clickText('生成编辑结果', {selector:'button'});
            await ctx.waitFor(`${studioDocument}?.querySelector('#busyLayer')?.classList.contains('visible') === true`);
          }
          await ctx.navigateHash(`/workspace/${workspaceId}/session/${otherId}`);
          await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="${otherId}"]'))`);
          edited = reuseEdited || await waitForNewOutput(ctx, workspaceId, sessionId, previousPaths);
          const other = await api(ctx, workspaceId, `/artifacts?sessionId=${encodeURIComponent(otherId)}`);
          ctx.assert(!other.items.some(item=>item.path === generated.path || item.path === edited.path), 'Outputs must not leak into the session opened during generation');
          await ctx.navigateHash(route);
          await openOutputs(ctx);
          await expectCard(ctx, edited.path);
          await openImageCard(ctx, edited.path);
        },
        assert: async () => {
          ctx.assert(edited.path !== generated.path, 'Edit must use a new path');
          ctx.assert(await api(ctx, workspaceId, `/files/raw?path=${encodeURIComponent(generated.path)}`, 'hash') === originalHash, 'Original bytes must remain unchanged');
          await expectCard(ctx, generated.path);
          await expectCard(ctx, edited.path);
          ctx.output('Edited output', JSON.stringify(edited));
          await showWindow(ctx);
        },
        screenshot: {name:'edited-session-output',requireText:['产出','文件']},
      });
      await ctx.prove('Reopening retains both outputs and their file cards open in Image Studio', {
        voiceover: vo[2],
        action: async () => {
          const timeOrigin = await ctx.eval('performance.timeOrigin');
          await ctx.client.send('Page.reload');
          await ctx.waitFor(`performance.timeOrigin !== ${timeOrigin} && Boolean(window.__ipolloworkControl)`, {timeoutMs:30000});
          await ctx.waitFor(`location.hash.includes(${JSON.stringify(sessionId)})`);
          await openOutputs(ctx);
          await expectCard(ctx, edited.path);
        },
        assert: async () => {
          await expectCard(ctx, generated.path);
          await expectCard(ctx, edited.path);
          ctx.assert(JSON.stringify(await api(ctx, workspaceId, messagePath)) === beforeMessages, 'The chat transcript must remain unchanged');
          await openImageCard(ctx, generated.path);
          await expectCard(ctx, edited.path);
          await showWindow(ctx);
        },
        screenshot: {name:'reopened-session-outputs',requireText:['产出','图片工作台']},
      });
    },
  }],
};
