import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import createWeChatOfficialService from './wechat-official.mjs';

function authorizationFixture(initial = {}, selectedAccountId = Object.keys(initial)[0] ?? null) {
  const credentials = new Map(Object.entries(initial));
  let active = selectedAccountId;
  return {
    async listConnections() {
      return [...credentials.keys()].sort().map(accountId => ({ accountId, methodId: 'wechat-official-account', status: 'connected', fields: { appId: true, appSecret: true }, updatedAt: 1_788_000_000_000 }));
    },
    async getCredential(_methodId, accountId) { return credentials.get(accountId ?? active) ?? null; },
    async readCredential(accountId) { return credentials.get(accountId) ?? null; },
    async saveCredential(_methodId, accountId, values) {
      credentials.set(accountId, { ...values }); active = accountId;
      return { accountId, methodId: 'wechat-official-account', status: 'connected', fields: { appId: true, appSecret: true }, updatedAt: Date.now() };
    },
    async setActiveAccount(_methodId, accountId) {
      if (!credentials.has(accountId)) return false;
      active = accountId; return true;
    },
    async revokeAccount(accountId) { return credentials.delete(accountId); },
  };
}

async function listen(server) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

test('Studio remains available before account authorization and reports an empty disconnected state', async t => {
  const service = await createWeChatOfficialService({
    plugin: { id: 'wechat-official', version: '0.3.0' },
    authorization: authorizationFixture(),
    workspace: { root: process.cwd() },
  });
  t.after(() => service.dispose());

  const state = await service.actions['studio-state']({}, {});
  assert.equal(state.connection.connected, false);
  assert.deepEqual(state.drafts, { totalCount: 0, itemCount: 0, items: [] });
  assert.match((await service.actions['open-workbench']({}, {})).url, /^http:\/\/127\.0\.0\.1:\d+\/#token=/);
});

test('Studio reuses declared service actions behind a protected local-only HTTP bridge', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'wechat-studio-'));
  const upstream = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.local');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/cgi-bin/token') {
      response.end(JSON.stringify({ access_token: `fixture-token-${url.searchParams.get('appid')}`, expires_in: 7200 }));
      return;
    }
    if (url.pathname === '/cgi-bin/draft/batchget') {
      const account = url.searchParams.get('access_token')?.endsWith('-b') ? 'B' : url.searchParams.get('access_token')?.endsWith('-c') ? 'C' : 'A';
      response.end(JSON.stringify({ total_count: 3, item_count: 1, item: [{ media_id: `draft-${account}`, update_time: 1_788_000_000, content: { news_item: [{ title: `九月运营手记 ${account}` }] } }] }));
      return;
    }
    response.end(JSON.stringify({ errcode: 0 }));
  });
  const apiBase = await listen(upstream);
  const previousApiBase = process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE;
  process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE = apiBase;
  const service = await createWeChatOfficialService({
    plugin: { id: 'wechat-official', version: '0.3.0' },
    authorization: authorizationFixture({
      'brand-a': { appId: 'wx-fixture-account-a', appSecret: 'never-expose-a' },
      'brand-b': { appId: 'wx-fixture-account-b', appSecret: 'never-expose-b' },
    }, 'brand-a'),
    workspace: { root },
  });
  t.after(async () => {
    await service.dispose();
    await new Promise(done => { upstream.close(done); upstream.closeAllConnections(); });
    if (previousApiBase === undefined) delete process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE;
    else process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE = previousApiBase;
    await rm(root, { recursive: true, force: true });
  });

  const [first, second] = await Promise.all([service.actions['open-workbench']({}, {}), service.actions['open-workbench']({}, {})]);
  assert.equal(first.url, second.url);
  const studio = new URL(first.url);
  const token = new URLSearchParams(studio.hash.slice(1)).get('token');
  studio.hash = '';

  const html = await fetch(studio);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /公众号 Studio/);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(new URL('/api/state', studio))).status, 401);
  assert.equal((await fetch(new URL('/api/state', studio), { headers: { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example' } })).status, 403);

  const stateResponse = await fetch(new URL('/api/state', studio), { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(stateResponse.status, 200);
  const stateText = await stateResponse.text();
  assert.match(stateText, /九月运营手记 A/);
  assert.match(stateText, /brand-a/);
  assert.match(stateText, /brand-b/);
  assert.doesNotMatch(stateText, /never-expose|fixture-token/);

  const switched = await fetch(new URL('/api/actions/select-account', studio), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'brand-b' }),
  });
  assert.equal(switched.status, 200);
  const switchedState = await fetch(new URL('/api/state', studio), { headers: { Authorization: `Bearer ${token}` } });
  assert.match(await switchedState.text(), /九月运营手记 B/);

  const added = await fetch(new URL('/api/accounts', studio), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'brand-c', appId: 'wx-fixture-account-c', appSecret: 'never-expose-c' }),
  });
  assert.equal(added.status, 200);
  const addedText = await added.text();
  assert.match(addedText, /brand-c/);
  assert.match(addedText, /九月运营手记 C/);
  assert.doesNotMatch(addedText, /never-expose|fixture-token/);

  const removed = await fetch(new URL('/api/accounts/brand-c', studio), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(removed.status, 200);
  assert.doesNotMatch(await removed.text(), /brand-c/);

  const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), '../ipollowork.plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const declared = manifest.resources.find(resource => resource.type === 'local-service').actions.map(action => action.id).sort();
  assert.deepEqual(declared, Object.keys(service.actions).sort());
});
