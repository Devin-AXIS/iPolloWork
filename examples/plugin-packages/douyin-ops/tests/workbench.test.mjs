import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../service/server.mjs';
import createWorkbench from '../service/workbench.mjs';

test('HTTP API requires its local token, rejects cross-origin and unknown paths, and redacts settings', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'douyin-http-'));
  const service = await startServer({ dataDir: root, workspaceRoot: root });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const { origin, token } = service, headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(origin + '/api/state')).status, 401);
  assert.equal((await fetch(origin + '/api/state', { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
  const html = await fetch(origin + '/'), htmlText = await html.text();
  assert.match(htmlText, /抖音运营台/);
  assert.match(htmlText, /class="app-shell"/);
  assert.match(htmlText, /class="sidebar"/);
  assert.doesNotMatch(htmlText, /<span>抖音<\/span>/);
  assert.match(htmlText, /id="add-account"[^>]*aria-label="添加账号"/);
  assert.match(htmlText, /id="manage-account"/);
  assert.match(htmlText, /id="view-overview"/);
  assert.match(htmlText, /data-view="overview" aria-current="page"/);
  assert.match(htmlText, /让下一条内容/);
  for (const capability of ['publish', 'listVideos', 'comments', 'searchVideos']) assert.match(htmlText, new RegExp(`data-capability="${capability}"`));
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  const initialState = await (await fetch(origin + '/api/state', { headers })).json();
  assert.equal(initialState.capabilities.searchVideos.status, 'configuration_required');
  assert.equal(initialState.capabilities.searchVideos.available, false);
  const save = await fetch(origin + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ clientKey: 'fixture', clientSecret: 'never-expose-this', scopes: 'user_info', redirectUri: 'https://example.com/callback' }) });
  assert.equal(save.status, 200);
  assert.doesNotMatch(await save.text(), /never-expose-this/);
  assert.doesNotMatch(await (await fetch(origin + '/api/state', { headers })).text(), /never-expose-this/);
  assert.equal((await fetch(origin + '/api/actions/unknown', { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(origin + '/api/actions/studio-state', { method: 'POST', headers, body: '[' })).status, 400);
  assert.equal((await fetch(origin + '/api/media', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/html' }, body: 'not a video' })).status, 400);
});

test('native plugin entry launches once without installation, exposes matching actions, disposes its process', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'douyin-bridge-'));
  const runtime = { storage: { dataDir: resolve(root, 'data') }, workspace: { root }, plugin: { version: '0.1.0' } };
  const bridge = createWorkbench(runtime);
  const manifest = JSON.parse(await readFile(new URL('../ipollowork.plugin.json', import.meta.url), 'utf8'));
  const resource = manifest.resources.find(item => item.type === 'local-service');
  assert.ok(resource.actions.some(action => action.id === resource.browserSession.observeAction), 'automatic observer must be declared');
  assert.equal(typeof bridge.actions[resource.browserSession.observeAction], 'function', 'automatic observer must have an implementation');
  t.after(async () => {
    await bridge.dispose();
    for (let i = 0; i < 30; i++) {
      try { await rm(root, { recursive: true, force: true }); break; }
      catch (error) { if (i === 29) throw error; await new Promise(done => setTimeout(done, 100)); }
    }
  });
  const [first, second] = await Promise.all([bridge.actions['open-workbench'](), bridge.actions['open-workbench']()]);
  assert.equal(first.url, second.url);
  assert.equal(new URL(first.url).hostname, '127.0.0.1');
  assert.deepEqual(await bridge.actions['list-accounts'](), { accounts: [] });
  const { account } = await bridge.actions['connect-browser']({});
  await assert.rejects(bridge.actions['observe-browser-session']({}, {}), /会话或日程/);
  const draftInput = { accountId: account.id, id: 'invented-id', title: '标题', text: '文案', runKey: 'regression:draft' };
  await assert.rejects(bridge.actions['save-draft'](draftInput), error =>
    error.status === 400 && error.code === 'douyin_draft_not_found' && /(?:新建|创建新草稿)请省略 id/.test(error.message));
  const { id: _invalidId, ...createInput } = draftInput;
  const { draft } = await bridge.actions['save-draft'](createInput);
  assert.ok(draft.id);
  assert.equal((await bridge.actions['save-draft'](createInput)).draft.id, draft.id);
  assert.equal((await bridge.actions['studio-state']()).drafts.length, 1);
  const { job: read } = await bridge.actions['search-videos']({ accountId: account.id, keyword: '中断恢复' });
  const { job: ended } = await bridge.actions['cancel-read-job']({ jobId: read.id, accountId: account.id, evidence: '读取已中断' });
  assert.equal(ended.errorCode, 'read_cancelled');
  assert.equal((await bridge.actions['get-job']({ jobId: read.id })).job.status, 'failed');
  await assert.rejects(bridge.actions['publish-draft']({}, {}), /会话或日程/);
  await assert.rejects(bridge.actions['finish-browser-job']({}, {}), error => {
    assert.doesNotMatch(error.message, /会话或日程/);
    assert.equal(error.code, 'douyin_invalid_input');
    return true;
  });
  await bridge.dispose();
  await assert.rejects(bridge.actions['open-workbench'](), /已关闭/);
});
