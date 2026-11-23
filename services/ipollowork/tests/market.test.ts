import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../src/app.js';
import { testConfig } from './database.js';

test('market persists references, authorizes every mutation, and serializes concurrent additions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-market-'));
  const config = await testConfig({ DATA_DIR: dir, SERVICE_ORIGIN: 'http://localhost:4785' });
  let service = await createService(config);
  let requestId = 0;
  const call = async (path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await service.app.request(config.origin + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-ipollo-peer-ip': '192.0.2.' + (++requestId), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() as any };
  };
  const entry = (name: string) => ({ name, title: 'Reviewed plugin', description: 'A recommended plugin', author: 'Publisher', metadata: { category: 'productivity' }, versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' }, engines: { dsh: '>=0.2.2-rc.3' } }] });
  try {
    assert.equal((await call('/api/v1/market/manage')).status, 401);
    const signup = await call('/api/auth/sign-up/email', undefined, { name: 'Admin', email: 'market@example.com', password: 'Valid-test-password-2026' });
    assert.equal(signup.status, 200);
    const token = signup.data.token as string;
    assert.deepEqual((await call('/api/v1/market/manage', token)).data, { canManage: false });
    assert.equal((await call('/api/v1/market/plugins', token, entry('plugin-a'))).status, 403);
    assert.equal((await call('/api/v1/market/discover', token, { source: 'https://github.com/example/plugin' })).status, 403);
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', 'admin', signup.data.user.id);
    assert.deepEqual((await call('/api/v1/market/manage', token)).data, { canManage: true });
    assert.equal((await call('/api/v1/market/discover', token, { source: 'http://localhost/private' })).status, 400);
    const malformed = entry('invalid'); malformed.versions[0]!.engines.dsh = 'workspace:*';
    assert.equal((await call('/api/v1/market/plugins', token, malformed)).status, 400);
    const outcomes = await Promise.all(['plugin-a', 'plugin-b'].map(name => call('/api/v1/market/plugins', token, entry(name))));
    assert.deepEqual(outcomes.map(result => result.status), [201, 201]);
    assert.equal((await call('/api/v1/market/plugins', token, entry('plugin-a'))).status, 409);
    const git = { ...entry('plugin-git'), versions: [{ version: '2.0.0', publishTimestamp: 2, source: { type: 'git', url: 'https://github.com/publisher/plugin', commit: 'a'.repeat(40), path: 'packages/plugin' } }] };
    assert.equal((await call('/api/v1/market/plugins', token, git)).status, 201);
    assert.equal((await call('/api/v1/market/plugins', token, { ...git, name: 'unsafe', versions: [{ ...git.versions[0], source: { ...git.versions[0]!.source, url: 'https://user:secret@github.com/a/b' } }] })).status, 400);
    const original = entry('plugin-a');
    const changed = { ...original, title: 'Edited title', description: 'Reviewed introduction' };
    const updates = await Promise.all([changed, { ...changed, title: 'Concurrent edit' }].map(next =>
      call('/api/v1/market/plugins', token, { expected: original, entry: next }, 'PATCH')));
    assert.deepEqual(updates.map(x => x.status).sort(), [200, 409]);
    const winner = updates[0].status === 200 ? changed.title : 'Concurrent edit';
    assert.equal((await service.store.one('SELECT count(*) AS n FROM audit WHERE action=?', 'market.update'))?.n, 1);
    assert.equal((await service.store.one('SELECT count(*) AS n FROM audit WHERE action=?', 'market.add'))?.n, 3);
    await service.close(); service = await createService(config);
    const catalog = await call('/api/market/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.plugins.length, 3);
    assert.equal(catalog.data.plugins.find((p: { name: string }) => p.name === original.name).title, winner);
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', 'user', signup.data.user.id);
    assert.equal((await call('/api/v1/market/plugins', token, entry('revoked'))).status, 403);
    assert.equal((await call('/api/market/catalog')).data.plugins.length, 3);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});

import { discoverMarket } from '../src/market-discovery.js';
import { marketEntry } from '../src/market.js';
test('discovery reads pinned GitHub metadata and fills editable copy from the plugin README', async () => {
  const sha = 'a'.repeat(40);
  const data = new Map([
    ['https://api.github.com/repos/example/repo/commits/main', JSON.stringify({ sha, commit: { committer: { date: '2026-11-20T08:00:00Z' } } })],
    [`https://api.github.com/repos/example/repo/contents/packages/decision/package.json?ref=${sha}`, JSON.stringify({ name: '@example/decision', version: '1.0.0', dsh: { bundle: { patch: './bundle.yml' } } })],
    [`https://api.github.com/repos/example/repo/contents/packages/decision/README.md?ref=${sha}`, '# 决策情报\n\n为每项决策整理指标和来源。'],
  ]);
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).includes('/contents/')) assert.equal(new Headers(init?.headers).get('accept'), 'application/vnd.github.raw+json');
    return new Response(data.get(String(url)), { status: data.has(String(url)) ? 200 : 404 });
  };
  const entry = marketEntry.parse(await discoverMarket('https://github.com/example/repo/tree/main/packages/decision', fetcher));
  assert.equal(entry.title, '决策情报');
  assert.equal(entry.description, '为每项决策整理指标和来源。');
  assert.deepEqual(entry.versions[0].source, { type: 'git', url: 'https://github.com/example/repo', commit: sha, path: 'packages/decision' });
  const npm = 'https://registry.npmjs.org/%40example%2Fdecision/1.0.0';
  data.set(npm, JSON.stringify({ name: '@example/decision', version: '1.0.0', displayName: 'Decision', description: 'Market analysis', author: { name: 'Example' }, dsh: { bundle: { patch: './bundle.yml' } } }));
  const pkg = marketEntry.parse(await discoverMarket('@example/decision@1.0.0', fetcher));
  assert.equal(pkg.author, 'Example');
  assert.equal(pkg.description, 'Market analysis');
  data.set(npm, JSON.stringify({ name: '@example/decision', version: '1.0.0' }));
  await assert.rejects(discoverMarket('@example/decision@1.0.0', fetcher), { code: 'MARKET_SOURCE_MANIFEST' });
});
