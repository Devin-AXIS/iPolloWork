import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A private owner record from a disposable, running official Web profile only.
const ownerFile = process.env.IPOLLO_LIFECYCLE_OWNER_FILE;

test('official manager retains its Remote definitions across suite activation cycles', { skip: !ownerFile, timeout: 60000 }, async () => {
  const { origin, cookie } = JSON.parse(await readFile(ownerFile, 'utf8'));
  const rpc = async (method, args) => {
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'suite-lifecycle', method, payload: { args } }),
    });
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.value;
  };
  for (const enabled of [false, true, false, true]) {
    const result = await rpc('pluginManager/setBundleEnabled', { name: '@ipollo/dsh-suite', enabled });
    assert.equal(result.application, 'applied', JSON.stringify(result));
    const plugins = await rpc('pluginManager/listPlugins', {});
    assert(plugins.some(row => row.moduleName === '@deepseek-ai/dsh-plugin-manager' && row.fiberPhase === 'active'));
    const suite = plugins.filter(row => row.moduleName.startsWith('@ipollo/dsh-suite'));
    if (enabled) {
      assert.equal(suite.length, 4);
      assert(suite.every(row => row.fiberPhase === 'active'));
    }
    const info = await fetch(`${origin}/ipollowork-suite/info`, { headers: { cookie } });
    assert.equal(info.status, enabled ? 200 : 404);
  }
});
