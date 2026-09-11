import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  await assert.rejects(bridge.actions['publish-draft']({}, {}), /会话或日程/);
  await bridge.dispose();
  await assert.rejects(bridge.actions['open-workbench'](), /已关闭/);
});
