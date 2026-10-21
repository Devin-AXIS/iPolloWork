import { readFile, access } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
import { seedResourceLifecycleFixtures } from '../support/resource-lifecycle-fixture.mjs';

const vo = await loadVoiceoverParagraphs('resource-lifecycle');
const root = process.env.IPOLLOWORK_LIFECYCLE_PROOF_ROOT;
const fixtures = { base: '', items: [['opencode','OpenCode 回收验证'],['codex-harness','Codex 回收验证'],['deepseek-harness','DeepSeek 回收验证']].map(([engineId,name]) => ({ engineId, name })) };
let headers;
async function api(path) {
  if (!headers) {
    const tokens = Object.values(JSON.parse(await readFile(join(root, 'electron/ipollowork-server-tokens.json'), 'utf8')).workspaces)[0];
    headers = { Authorization: `Bearer ${tokens.clientToken}`, 'X-iPolloWork-Host-Token': tokens.hostToken };
  }
  const response = await fetch(fixtures.base + path, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Witness HTTP ${response.status}: ${path}`);
  return response.json();
}
async function exists(path) { return access(path).then(() => true, () => false); }
async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: selector });
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function menuItem(ctx, text) {
  await ctx.waitFor(`Array.from(document.querySelectorAll('[role="menuitem"]')).some(el => el.textContent.trim() === ${JSON.stringify(text)})`, { label: text });
  await ctx.eval(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);
}
async function sessionMenu(ctx, item) {
  const expression = `Array.from(document.querySelectorAll('[data-sidebar="menu-sub-item"]')).find(el => el.textContent.includes(${JSON.stringify(item.name + ' 会话')}))?.querySelector('[aria-haspopup="menu"]')`;
  await ctx.waitFor(`Boolean(${expression})`, { label: `${item.engineId} conversation row` });
  await ctx.eval(`(${expression}).click()`);
}
async function projectMenu(ctx, item) {
  const selector = `[data-testid="project-actions-menu"][data-project-id="${item.workspaceId}"]`;
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: selector });
  await ctx.eval(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if(button.getAttribute('aria-expanded') !== 'true') button.click(); })()`);
}
async function settle(ctx) { await ctx.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', { awaitPromise: true }); }
async function witnessSession(item, archived) {
  let persisted = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const { item: session } = await api(`/workspace/${item.workspaceId}/sessions/${item.sessionId}`);
    if (Boolean(session.time?.archived) === archived) { persisted = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!persisted) throw new Error('Archive flag did not persist');
  if (!await exists(join(item.path, 'design', item.sessionId, 'index.html'))) throw new Error('Archive removed the artifact');
  for (const path of item.nativeSessionDirectories || []) if (!await exists(path)) throw new Error('Archive removed native session history');
}

export default {
  id: 'resource-lifecycle', title: '归档可恢复；删除清理会话、项目及所属文件', kind: 'user-facing',
  requiredEnv: ['IPOLLOWORK_LIFECYCLE_PROOF_ROOT'],
  steps: [
    { name: 'Fixture boundary and desktop readiness', run: async ctx => {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30000 });
      const seeded = await seedResourceLifecycleFixtures(root);
      fixtures.base = seeded.base;
      for (const item of fixtures.items) Object.assign(item, seeded.items.find(seed => seed.engineId === item.engineId));
      await ctx.client.send('Page.reload', { ignoreCache: true });
      await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30000 });
      for (const item of fixtures.items) {
        ctx.assert(resolve(item.path).startsWith(resolve(root) + sep), 'Only isolated proof projects can be deleted');
      }
      const { items } = await api('/workspaces');
      for (const item of fixtures.items) item.workspaceId ||= items.find(workspace => workspace.path === item.path)?.id;
    } },
    ...['opencode', 'codex-harness', 'deepseek-harness'].flatMap(engineId => {
      const item = fixtures?.items.find(item => item.engineId === engineId);
      return [
        { name: `${engineId}: menu`, run: async ctx => ctx.prove(`${engineId} exposes both lifecycle actions`, {
          voiceover: vo[0], action: async () => {
            ctx.assert(item?.sessionId, 'Native fixture session was created without a paid model call');
            await ctx.navigateHash(`/workspace/${item.workspaceId}/session`);
            await sessionMenu(ctx, item);
          }, assert: async () => { await ctx.expectText('归档会话'); await ctx.expectText('删除会话'); },
          screenshot: { name: `${engineId}-menu`, requireText: ['归档会话', '删除会话'] },
        }) },
        { name: `${engineId}: archive and restore`, run: async ctx => ctx.prove(`${engineId} archive is recoverable and preserves files`, {
          voiceover: vo[1], action: async () => {
            await menuItem(ctx, '归档会话');
            await ctx.waitFor(`document.body.innerText.includes('已归档')`, { label: 'Archived session group' });
            await witnessSession(item, true);
            await ctx.eval(`(() => { const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('已归档') && !el.textContent.includes('项目')); if(button.getAttribute('aria-expanded') !== 'true') button.click(); })()`);
            await sessionMenu(ctx, item); await menuItem(ctx, '恢复会话');
            await ctx.waitFor(`!document.querySelector('[role="menu"]')`, { label: 'Restore menu closed' }); await settle(ctx);
          }, assert: async () => {
            await witnessSession(item, false);
            await ctx.waitFor(`document.querySelector('[data-testid="projects-section"]').innerText.includes(${JSON.stringify(item.name + ' 会话')})`, { label: 'Restored conversation in its active project' });
          },
          screenshot: { name: `${engineId}-restored`, requireText: [item?.name + ' 会话'] },
        }) },
        { name: `${engineId}: permanent session deletion`, run: async ctx => ctx.prove(`${engineId} deletion removes the native session and owned directory`, {
          voiceover: vo[2], action: async () => {
            await sessionMenu(ctx, item); await menuItem(ctx, '删除会话');
            await ctx.expectText('无法恢复');
            await ctx.eval(`Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(el => el.textContent.trim() === '删除').click()`);
            await ctx.waitFor(`!document.querySelector('[role="alertdialog"]')`, { label: 'Delete dialog closed' });
            await ctx.waitFor(`!document.body.innerText.includes(${JSON.stringify(item.name + ' 会话')})`, { label: 'Session removed from sidebar' });
          }, assert: async () => {
            ctx.assert(!await exists(join(item.path, 'design', item.sessionId)), 'Owned session directory no longer exists');
            const response = await fetch(fixtures.base + `/workspace/${item.workspaceId}/sessions/${item.sessionId}`, { headers });
            ctx.assert(response.status === 404, 'Deleted session returns 404');
            for (const path of item.nativeSessionDirectories || []) ctx.assert(!await exists(path), 'Native DSH history directory no longer exists');
            if (engineId === 'deepseek-harness') {
              const nativeResponse = await fetch(fixtures.base + `/workspace/${item.workspaceId}/engine/deepseek-harness/rpc`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
                body: JSON.stringify({ method: 'session.list', payload: {} }),
              });
              ctx.assert(nativeResponse.ok, 'Native DSH session list is readable after restarting the runtime');
              const native = await nativeResponse.json();
              ctx.assert(!native.value.items.some(session => session.sessionId === item.sessionId), 'Restarted native DSH no longer discovers the deleted session');
            }
          }, screenshot: { name: `${engineId}-deleted`, requireText: [item?.name], rejectText: [item?.name + ' 会话'] },
        }) },
      ];
    }),
    ...['opencode', 'codex-harness', 'deepseek-harness'].flatMap(engineId => {
      const item = fixtures?.items.find(item => item.engineId === engineId);
      return [
        { name: `${engineId}: project archive and restore`, run: async ctx => ctx.prove(`${engineId} project archive retains the folder and can be restored`, {
          voiceover: vo[3], action: async () => {
            await projectMenu(ctx, item); await menuItem(ctx, '归档项目');
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="archived-projects-section"]'))`, { label: 'Archived projects group' });
            ctx.assert(await exists(item.path), 'Project folder survived archiving');
            await ctx.eval(`(() => { const button = document.querySelector('[data-testid="archived-projects-section-toggle"]'); if(button.getAttribute('aria-expanded') !== 'true') button.click(); })()`);
            await projectMenu(ctx, item); await menuItem(ctx, '恢复项目');
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="projects-section"] [data-project-id="${item.workspaceId}"]'))`, { label: 'Project restored into active list' });
            await projectMenu(ctx, item);
          }, assert: async () => {
            const { items } = await api('/workspaces'); ctx.assert(!items.find(project => project.id === item.workspaceId)?.archivedAt, 'Project archive flag was cleared');
            ctx.assert(await exists(item.path), 'Project folder still exists');
          }, screenshot: { name: `${engineId}-project-restored`, requireText: [item?.name, '归档项目'] },
        }) },
        { name: `${engineId}: permanent project deletion`, run: async ctx => ctx.prove(`${engineId} project deletion removes its folder and registry`, {
          voiceover: vo[4], action: async () => {
            await projectMenu(ctx, item); await menuItem(ctx, '删除项目');
            await ctx.expectText('永久删除这个项目'); await ctx.expectText(item.path);
            await ctx.eval(`Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(el => el.textContent.trim() === '删除项目').click()`);
            await ctx.waitFor(`!document.querySelector('[role="alertdialog"]')`, { label: 'Project delete dialog closed' });
            await ctx.waitFor(`!document.querySelector('[data-project-id="${item.workspaceId}"]')`, { timeoutMs: 30000, label: 'Project removed' });
          }, assert: async () => {
            ctx.assert(!await exists(item.path), 'Entire project directory was physically deleted');
            const { items } = await api('/workspaces'); ctx.assert(!items.some(project => project.id === item.workspaceId), 'Project is absent from the registry');
          }, screenshot: { name: `${engineId}-project-deleted`, requireText: ['新建任务'], rejectText: [item?.name] },
        }) },
      ];
    }),
  ],
};
