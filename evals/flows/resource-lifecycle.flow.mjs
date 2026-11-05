import { readFile, access } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';
import { seedResourceLifecycleFixtures, nativeHistoryExists } from '../support/resource-lifecycle-fixture.mjs';

const vo = await loadVoiceoverParagraphs('resource-lifecycle');
const root = process.env.IPOLLOWORK_LIFECYCLE_PROOF_ROOT;
let fixtures, headers;
async function api(path) {
  if (!headers) {
    const tokens = Object.values(JSON.parse(await readFile(join(root, 'electron/ipollowork-server-tokens.json'), 'utf8')).workspaces)[0];
    headers = { Authorization: `Bearer ${tokens.clientToken}`, 'X-iPolloWork-Host-Token': tokens.hostToken };
  }
  return fetch(fixtures.base + path, { headers, signal: AbortSignal.timeout(120000) });
}
async function exists(path) { return access(path).then(() => true, () => false); }
async function menuItem(ctx, text) {
  const expression = `Array.from(document.querySelectorAll('[role="menuitem"]')).find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
  await ctx.waitFor(`Boolean(${expression})`, { label: text });
  await ctx.eval(`(${expression}).click()`);
}
async function sessionMenu(ctx, item) {
  await ctx.navigateHash(`/workspace/${item.workspaceId}/session`);
  const expression = `Array.from(document.querySelectorAll('[data-sidebar="menu-sub-item"]')).find(el => el.textContent.includes(${JSON.stringify(item.title)}))?.querySelector('[aria-haspopup="menu"]')`;
  await ctx.waitFor(`Boolean(${expression})`, { label: item.title, timeoutMs: 60000 });
  await ctx.eval(`(${expression}).click()`);
}
async function projectMenu(ctx, item) {
  const selector = `[data-testid="project-actions-menu"][data-project-id="${item.workspaceId}"]`;
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: item.name, timeoutMs: 30000 });
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function chooseScope(ctx, files) {
  await ctx.expectText('仅从软件中删除');
  await ctx.expectText('同时删除本地相关文件');
  await ctx.expectText('删除时间较长');
  await ctx.waitFor(`document.querySelector('[role="alertdialog"] [role="radio"][aria-checked="true"]')?.closest('label')?.textContent.includes('仅从软件中删除')`, { label: 'Software-only is the default scope' });
  if (files) await ctx.eval(`Array.from(document.querySelectorAll('[role="alertdialog"] label')).find(el => el.textContent.includes('同时删除本地相关文件')).click()`);
}
async function confirm(ctx, text) {
  await ctx.eval(`Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);
  await ctx.waitFor(`!document.querySelector('[role="alertdialog"]')`, { timeoutMs: 120000, label: 'Deletion completed and dialog closed' });
}
async function witnessSession(ctx, item, files) {
  ctx.assert(await exists(join(item.path, 'design', item.sessionId, 'index.html')) === !files, 'Owned artifact follows selected scope');
  ctx.assert(await nativeHistoryExists(root, item) === !files, 'Native engine history follows selected scope');
  ctx.assert((await api(`/workspace/${item.workspaceId}/sessions/${item.sessionId}`)).status === 404, 'Deleted session cannot be reopened');
  const list = await (await api(`/workspace/${item.workspaceId}/sessions`)).json();
  ctx.assert(!list.items.some(session => session.id === item.sessionId), 'Native discovery cannot resurrect the session');
}
async function restartHost(ctx) {
  const connection = await ctx.eval("window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerRestart', {})", { awaitPromise: true });
  fixtures.base = connection.baseUrl;
  headers = { Authorization: `Bearer ${connection.clientToken}`, 'X-iPolloWork-Host-Token': connection.hostToken };
  await ctx.client.send('Page.reload', { ignoreCache: true });
  await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 60000 });
}
const engines = ['opencode', 'codex-harness', 'deepseek-harness'];

export default {
  id: 'resource-lifecycle', title: '三个引擎：会话和项目的两种删除范围', kind: 'user-facing',
  requiredEnv: ['IPOLLOWORK_LIFECYCLE_PROOF_ROOT'],
  steps: [
    { name: 'Isolated native fixtures', run: async ctx => {
      await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30000 });
      const connection = await ctx.eval("window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo', {})", { awaitPromise: true });
      fixtures = await seedResourceLifecycleFixtures(root, connection);
      headers = { Authorization: `Bearer ${connection.clientToken}`, 'X-iPolloWork-Host-Token': connection.hostToken };
      for (const item of fixtures.items) ctx.assert(resolve(item.path).startsWith(resolve(root) + sep), 'Only isolated projects are deleted');
      await ctx.client.send('Page.reload', { ignoreCache: true });
      await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30000 });
    } },
    ...engines.flatMap(engineId => ['software', 'files'].flatMap(scope => {
      const getItem = () => fixtures.items.find(item => item.engineId === engineId && item.projectScope === 'files' && item.sessionScope === scope);
      return [
        { name: `${engineId} session ${scope} choice`, run: async ctx => ctx.prove(`${engineId}: session deletion offers two scopes without archive or restore`, {
          voiceover: vo[0], action: async () => {
            await sessionMenu(ctx, getItem());
            await ctx.expectNoText('归档会话'); await ctx.expectNoText('恢复会话');
            await menuItem(ctx, '删除会话'); await chooseScope(ctx, scope === 'files');
          }, assert: async () => {
            await ctx.expectText('仅从软件中删除'); await ctx.expectText('同时删除本地相关文件'); await ctx.expectText('删除时间较长');
          }, screenshot: { name: `${engineId}-session-${scope}-choice`, requireText: ['仅从软件中删除', '同时删除本地相关文件', '删除时间较长'] },
        }) },
        { name: `${engineId} session ${scope} deletion`, run: async ctx => ctx.prove(`${engineId}: ${scope} session deletion persists and handles native history and files`, {
          voiceover: scope === 'files' ? vo[2] : vo[1], action: async () => {
            await confirm(ctx, '删除');
            await ctx.waitFor(`!document.querySelector('[data-testid="projects-section"]').innerText.includes(${JSON.stringify(getItem().title)})`, { label: 'Deleted session absent' });
            await ctx.client.send('Page.reload', { ignoreCache: true });
            await ctx.waitFor('Boolean(window.__ipolloworkControl)', { timeoutMs: 30000 });
          }, assert: async () => {
            await witnessSession(ctx, getItem(), scope === 'files');
            await ctx.waitFor(`!document.querySelector('[data-testid="projects-section"]').innerText.includes(${JSON.stringify(getItem().title)})`, { label: 'Still absent after UI reload' });
          }, screenshot: { name: `${engineId}-session-${scope}-deleted`, requireText: ['新建任务'] },
        }) },
      ];
    })),
    { name: 'Session deletion survives host restart', run: async ctx => ctx.prove('Deleted sessions stay absent after restarting the host and native engines', {
      voiceover: vo[5], action: async () => restartHost(ctx), assert: async () => {
        for (const item of fixtures.items.filter(item => item.sessionScope !== 'project')) {
          await witnessSession(ctx, item, item.sessionScope === 'files');
        }
      }, screenshot: { name: 'session-deletions-after-host-restart', requireText: ['新建任务'] },
    }) },
    ...engines.flatMap(engineId => ['software', 'files'].flatMap(scope => {
      const getItem = () => fixtures.items.find(item => item.engineId === engineId && item.projectScope === scope);
      return [
        { name: `${engineId} project ${scope} choice`, run: async ctx => ctx.prove(`${engineId}: project deletion offers both scopes without archive or restore`, {
          voiceover: vo[0], action: async () => {
            await projectMenu(ctx, getItem());
            await ctx.expectNoText('归档项目'); await ctx.expectNoText('恢复项目');
            await menuItem(ctx, '删除项目'); await chooseScope(ctx, scope === 'files');
          }, assert: async () => { await ctx.expectText(getItem().path); },
          screenshot: { name: `${engineId}-project-${scope}-choice`, requireText: ['删除这个项目', '仅从软件中删除', '删除时间较长'] },
        }) },
        { name: `${engineId} project ${scope} deletion`, run: async ctx => ctx.prove(`${engineId}: ${scope} project deletion handles registry, directory and native history`, {
          voiceover: scope === 'files' ? vo[4] : vo[3], action: async () => {
            await confirm(ctx, '删除项目');
            await ctx.waitFor(`!document.querySelector('[data-project-id="${getItem().workspaceId}"]')`, { timeoutMs: 30000, label: 'Project removed' });
          }, assert: async () => {
            const item = getItem();
            ctx.assert(await exists(item.path) === (scope === 'software'), 'Project folder follows selected scope');
            const workspaces = await (await api('/workspaces')).json();
            ctx.assert(!workspaces.items.some(workspace => workspace.id === item.workspaceId), 'Project registry entry removed');
            for (const session of fixtures.items.filter(session => session.workspaceId === item.workspaceId)) {
              const retained = scope === 'software';
              ctx.assert(await nativeHistoryExists(root, session) === retained, 'Project scope includes previously software-deleted native sessions');
              ctx.assert(await exists(join(session.path, 'design', session.sessionId)) === retained, 'Project files follow selected scope');
            }
          }, screenshot: { name: `${engineId}-project-${scope}-deleted`, requireText: ['新建任务'] },
        }) },
      ];
    })),
    { name: 'Persisted state after host restart', run: async ctx => ctx.prove('Deleted projects stay absent after host restart; software-only native histories and files remain', {
      voiceover: vo[5], action: async () => restartHost(ctx), assert: async () => {
        const workspaces = await (await api('/workspaces')).json();
        for (const item of fixtures.items) {
          ctx.assert(!workspaces.items.some(workspace => workspace.id === item.workspaceId), 'Deleted project remains absent');
          ctx.assert(await nativeHistoryExists(root, item) === (item.projectScope === 'software'), 'Native history retained or purged as selected');
          ctx.assert(await exists(item.path) === (item.projectScope === 'software'), 'Local folder retained or purged as selected');
        }
        await ctx.expectNoText('归档会话'); await ctx.expectNoText('恢复项目');
      }, screenshot: { name: 'all-deletions-persisted', requireText: ['新建任务'] },
    }) },
  ],
};
