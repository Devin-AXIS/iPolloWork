import test from 'node:test'
import assert from 'node:assert/strict'
import { blocksSuiteManagement, MANAGEMENT_DENIAL } from '../src/host/management.ts'
test('conversation mutations of the suite are refused while reads and other plugins remain available', () => {
  for (const action of ['set_bundle_enabled', 'remove_bundle', 'install_bundle', 'set_version_exemption']) {
    assert.equal(blocksSuiteManagement({ name: 'plugin_manager', arguments: { action, target: '@ipollo/dsh-suite' } }, 'entry:suite'), true)
  }
  assert.equal(blocksSuiteManagement({ name: 'plugin_manager', arguments: { action: 'set_plugin_enabled', target: 'entry:suite' } }, 'entry:suite'), true)
  assert.equal(blocksSuiteManagement({ name: 'plugin_manager', arguments: { action: 'list_bundles', target: '@ipollo/dsh-suite' } }, 'entry:suite'), false)
  assert.equal(blocksSuiteManagement({ name: 'plugin_manager', arguments: { action: 'remove_bundle', target: 'other-plugin' } }, 'entry:suite'), false)
  assert.equal(MANAGEMENT_DENIAL.kind, 'deny')
})
