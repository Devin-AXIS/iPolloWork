import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server.mjs';
import createWorkbench from '../service/workbench.mjs';

async function serverFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'channels-http-'));
  const service = await startServer({ dataDir: join(root, 'data'), workspaceRoot: root, token: 'ui-test-token', executorToken: 'executor-test-token' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const api = (name, body, token = 'ui-test-token', extraHeaders = {}) => fetch(`${service.origin}/api/actions/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
  return { root, service, api };
}
test('HTTP rejects missing credentials, wrong origin and local attempts to claim platform identity', async t => {
  const { service, api } = await serverFixture(t);
  assert.equal((await fetch(`${service.origin}/api/state`)).status, 401);
  assert.equal((await api('save-account', { name: '测试' }, 'ui-test-token', { Origin: 'https://evil.example' })).status, 403);
  const { account } = await (await api('save-account', { name: '本地账户' })).json();
  const identity = { accountId: account.id, actualChannelId: 'observed', actualName: '平台名', profileId: `wechat-channels-ops:${account.browserProfileId}`, sourceUrl: 'https://channels.weixin.qq.com/', evidence: '模拟页面' };
  assert.equal((await api('verify-account', identity)).status, 403);
  assert.equal((await api('verify-account', identity, 'executor-test-token')).status, 403);
  assert.equal((await api('verify-account', identity, 'executor-test-token', { 'X-Session-Id': 'test' })).status, 200);
  const target = await (await api('connect-account', {})).json();
  const observation = { browserProfileId: target.browserProfileId, url: 'https://channels.weixin.qq.com/platform/home',
    tree: 'heading "扫码账号"\nStaticText "视频号ID: sph-http"' };
  assert.equal((await api('observe-browser-session', observation)).status, 403);
  assert.equal((await api('observe-browser-session', observation, 'executor-test-token', { 'X-Session-Id': 'test' })).status, 200);
});
test('streaming media registration, signed preview and byte ranges work without leaking executor credentials', async t => {
  const { service } = await serverFixture(t);
  const bytes = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom'), Buffer.alloc(96)]);
  const upload = await fetch(`${service.origin}/api/media`, { method: 'POST', headers: { Authorization: 'Bearer ui-test-token', 'Content-Type': 'video/mp4', 'X-File-Name': encodeURIComponent('本地样片.mp4') }, body: bytes });
  assert.equal(upload.status, 200);
  const result = await (await fetch(`${service.origin}/api/state`, { headers: { Authorization: 'Bearer ui-test-token' } })).json();
  assert.equal(JSON.stringify(result).includes('executor-test-token'), false);
  const url = result.assets[0].previewUrl;
  assert.equal((await fetch(`${service.origin}/api/media/${result.assets[0].id}`)).status, 401);
  const range = await fetch(service.origin + url, { headers: { Range: 'bytes=4-7' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'ftyp');
  const invalid = await fetch(service.origin + url, { headers: { Range: 'bytes=9999-' } }); assert.equal(invalid.status, 416);
  const preview = await fetch(service.origin + url); assert.equal(preview.headers.get('content-type'), 'video/mp4');
  assert.equal((await preview.arrayBuffer()).byteLength, bytes.length);
});
test('HTTP rejects wrong file content and oversized JSON; source is not served', async t => {
  const { service, api } = await serverFixture(t);
  const upload = await fetch(`${service.origin}/api/media`, { method: 'POST', headers: { Authorization: 'Bearer ui-test-token', 'Content-Type': 'image/png', 'X-File-Name': 'fake.png' }, body: 'not png' });
  assert.equal(upload.status, 400);
  const large = await api('save-account', { name: 'x'.repeat(1100000) }); assert.equal(large.status, 413);
  const src = await fetch(`${service.origin}/service/server.mjs`, { headers: { Authorization: 'Bearer ui-test-token' } }); assert.equal(src.status, 404);
  const html = await fetch(service.origin); assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /default-src 'none'/);
});
test('local service wrapper starts, exposes declared actions and persists across restarts (mock host only)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'channels-wrapper-'));
  const runtime = { storage: { dataDir: join(root, 'data') }, workspace: { root }, plugin: { version: '0.1.0' } };
  let workbench = createWorkbench(runtime);
  t.after(async () => { await workbench.dispose(); await rm(root, { recursive: true, force: true }); });
  const launched = await workbench.actions['open-workbench'](); assert.match(launched.url, /^http:\/\/127\.0\.0\.1:\d+\/#token=/);
  const { account } = await workbench.actions['save-account']({ name: '持久化测试账号' });
  await workbench.dispose(); workbench = createWorkbench(runtime);
  const state = await workbench.actions['studio-state'](); assert.equal(state.accounts[0].id, account.id);
  assert.equal(Object.keys(workbench.actions).length, 17);
});
