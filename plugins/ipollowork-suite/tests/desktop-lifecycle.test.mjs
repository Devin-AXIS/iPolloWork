import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ownerFile = process.env.IPOLLO_DESKTOP_OWNER_FILE;

test('official manager protects application components while other plugin operations remain available', { skip: !ownerFile, timeout: 60000 }, async () => {
  const { origin, cookie } = JSON.parse(await readFile(ownerFile, 'utf8'));
  const rpc = async (method, args) => {
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'desktop-lifecycle', method, payload: { args } }),
    });
    const { result } = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return result.value;
  };
  const bundles = await rpc('pluginManager/listBundles', {});
  const app = bundles.find(bundle => bundle.name === '@ipollo/desktop-host');
  assert.equal(app.enabled, true);
  assert.equal(app.removable, false);
  assert.equal(app.readOnlyReason, 'management-required');
  const disable = await rpc('pluginManager/setBundleEnabled', { name: app.name, enabled: false });
  assert.equal(disable.error?.code, 'management-required');
  assert.equal(disable.changed, false);
  const remove = await rpc('pluginManager/removeBundle', { name: app.name });
  assert.equal(remove.error?.code, 'not-removable');
  const plugins = await rpc('pluginManager/listPlugins', {});
  const components = plugins.filter(row => row.moduleName.startsWith('@ipollo/dsh-suite'));
  assert.equal(components.length, 4);
  for (const component of components) {
    assert.equal(component.fiberPhase, 'active');
    assert.equal(component.readOnlyReason, 'unaddressable');
    const result = await rpc('pluginManager/setPluginEnabled', { id: component.entryId, enabled: false });
    assert.equal(result.error?.code, 'unaddressable');
    assert.equal(result.changed, false);
  }
  const info = await fetch(`${origin}/ipollowork-suite/info`, { headers: { cookie } });
  assert.equal(info.status, 200);
  assert.equal((await info.json()).dedicatedDesktop, true);
});
