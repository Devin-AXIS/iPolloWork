import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testConfig } from './database.js';
import { createService } from '../src/app.js';

test('cloud settings validate before commit, mask keys and retain saved credentials on empty edits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-cloud-settings-'));
  const config = await testConfig({ DATA_DIR: dir });
  const service = await createService(config);
  try {
    const account = await service.auth.api.signUpEmail({ body: { email: 'cloud-admin@example.test', name: 'Admin', password: 'Cloud-fixture-password-2026' } });
    const request = (body: unknown) => service.app.request('/api/v1/admin/settings/cloud', { method: 'PUT',
      headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await request({ enabled: 'true' })).status, 403);
    await service.store.run('UPDATE "user" SET role=? WHERE id=?', 'admin', account.user.id);
    assert.equal((await request({ enabled: 'true' })).status, 400);
    assert.deepEqual(await service.settings.get('cloud'), {});
    const key = 'only-a-local-fixture-gateway-key-2026';
    assert.equal((await request({ enabled: 'true', gatewayOrigin: 'https://gateway.example.test', gatewayKey: key, ttlSeconds: '1800' })).status, 200);
    assert.equal((await request({ enabled: 'false', gatewayKey: '', ttlSeconds: '' })).status, 200);
    assert.equal((await service.settings.get('cloud')).gatewayKey, key);
    for (const gatewayOrigin of ['http://remote.example.test', 'https://user:pass@example.test', 'https://example.test/path'])
      assert.equal((await request({ gatewayOrigin })).status, 400);
    assert.equal((await service.settings.get('cloud')).gatewayOrigin, 'https://gateway.example.test');
    const response = await service.app.request('/api/v1/admin/settings', { headers: { Authorization: 'Bearer ' + account.token } });
    const body = await response.json();
    assert.equal(body.cloud.gatewayKey, '••••••••');
    assert(!JSON.stringify(body).includes(key));
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
