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
  const call = async (path: string, token?: string, body?: unknown) => {
    const response = await service.app.request(config.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
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
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', 'admin', signup.data.user.id);
    assert.deepEqual((await call('/api/v1/market/manage', token)).data, { canManage: true });
    const malformed = entry('invalid'); malformed.versions[0]!.engines.dsh = 'workspace:*';
    assert.equal((await call('/api/v1/market/plugins', token, malformed)).status, 400);
    const outcomes = await Promise.all(['plugin-a', 'plugin-b'].map(name => call('/api/v1/market/plugins', token, entry(name))));
    assert.deepEqual(outcomes.map(result => result.status), [201, 201]);
    assert.equal((await call('/api/v1/market/plugins', token, entry('plugin-a'))).status, 409);
    const git = { ...entry('plugin-git'), versions: [{ version: '2.0.0', publishTimestamp: 2, source: { type: 'git', url: 'https://github.com/publisher/plugin', commit: 'a'.repeat(40), path: 'packages/plugin' } }] };
    assert.equal((await call('/api/v1/market/plugins', token, git)).status, 201);
    assert.equal((await call('/api/v1/market/plugins', token, { ...git, name: 'unsafe', versions: [{ ...git.versions[0], source: { ...git.versions[0]!.source, url: 'https://user:secret@github.com/a/b' } }] })).status, 400);
    assert.equal((await service.store.one('SELECT count(*) AS n FROM audit WHERE action=?', 'market.add'))?.n, 3);
    await service.close(); service = await createService(config);
    const catalog = await call('/api/market/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.plugins.length, 3);
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', 'user', signup.data.user.id);
    assert.equal((await call('/api/v1/market/plugins', token, entry('revoked'))).status, 403);
    assert.equal((await call('/api/market/catalog')).data.plugins.length, 3);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
