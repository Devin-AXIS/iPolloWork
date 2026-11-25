import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChangeResult, ClientRemote, PluginInstallRequestId, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { MarketInstallation } from '../src/client/market-installation.ts'

const target = { name: 'example-plugin', title: 'Example', version: '1.2.3', spec: 'example-plugin@1.2.3' }
const applied: ChangeResult = {
  changed: true, application: 'applied', stage: 'enable', target: target.name, bundle: target.name,
}

function fixture(
  prepareArchive?: ConstructorParameters<typeof MarketInstallation>[2],
  specToInstall = target.spec,
  expectedInstall = { name: target.name, version: target.version, enabled: false },
) {
  let installs = 0
  let cancellations = 0
  const pending = Promise.withResolvers<RemoteResult<ChangeResult>>()
  const inspection = Promise.withResolvers<Awaited<ReturnType<ClientRemote['pluginManager']['inspect']>>>()
  const manager: Pick<ClientRemote['pluginManager'], 'inspect' | 'installBundle' | 'waitForInstall' | 'cancelInstall' | 'setBundleEnabled'> = {
    inspect: async () => inspection.promise,
    installBundle: async (spec, options) => {
      installs++
      assert.equal(spec, specToInstall)
      assert.deepEqual(options?.expected, { name: expectedInstall.name, version: expectedInstall.version })
      assert.equal(options?.enabled, expectedInstall.enabled)
      return pending.promise
    },
    cancelInstall: async () => {
      cancellations++
      return { ok: true, value: { status: 'cancelled' } }
    },
    waitForInstall: async () => ({ ok: true, value: applied }),
    setBundleEnabled: async () => ({ ok: true, value: { ...applied, enabled: true } }),
  }
  const installation = new MarketInstallation(manager, new AbortController().signal, prepareArchive)
  return { installation, inspection, pending, counts: () => ({ installs, cancellations }) }
}

test('reviewed workspace market installs request native activation in the same operation', async () => {
  const reviewed = { ...target, spec: 'file:/cache/example.tgz', enableOnInstall: true }
  const { installation, pending, counts } = fixture(undefined, reviewed.spec, { ...target, enabled: true })
  installation.start(reviewed)
  pending.resolve({ ok: true, value: { ...applied, enabled: true } })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(counts().installs, 1)
  assert.equal(installation.getSnapshot().task?.result?.enabled, true)
})

test('archive update confirms both versions and installs only the prepared target', async () => {
  const fromVersion = '1.2.2'
  const spec = 'file:/cache/example.tgz'
  const prepare = Promise.withResolvers<string>()
  const update = { ...target, update: 'archive' as const, installedVersion: fromVersion }
  const { installation, pending, counts } = fixture(async request => {
    assert.deepEqual(request, { name: target.name, version: target.version, fromVersion })
    return prepare.promise
  }, spec)
  installation.start(update)
  assert.equal(installation.getSnapshot().task?.phase, 'confirm-update')
  installation.hide()
  assert.equal(installation.getSnapshot().task, null)
  assert.equal(counts().installs, 0)
  installation.start(update)
  installation.confirmUpdate()
  assert.equal(installation.getSnapshot().task?.phase, 'checking')
  assert.equal(counts().installs, 0)
  prepare.resolve(spec)
  pending.resolve({ ok: true, value: applied })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(counts().installs, 1)
  assert.equal(installation.getSnapshot().task?.phase, 'done')
  await installation.enable()
  assert.equal(installation.getSnapshot().task?.result?.enabled, undefined)
})

test('manual Add Plugin stays in progress when hidden during checks and during installation', async () => {
  const { installation, inspection, pending, counts } = fixture()
  installation.openManual()
  assert.equal(installation.getSnapshot().manual, true)
  const install = installation.startManual(target.spec, '', 'Add plugin')
  const { requestId } = installation.getSnapshot().task!
  installation.hide()
  assert.equal(installation.getSnapshot().task?.phase, 'checking')
  inspection.resolve({ ok: true, value: {
    status: 'accepted', kind: 'registry', name: target.name, version: target.version, bundle: true, registry: null,
  } })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(installation.getSnapshot().open, false)
  assert.equal(installation.getSnapshot().task?.requestId, requestId)
  installation.progress({ requestId, phase: 'installing' })
  installation.openManual()
  assert.equal(installation.getSnapshot().manual, false)
  assert.equal(installation.getSnapshot().open, true)
  installation.hide()
  pending.resolve({ ok: true, value: applied })
  await install
  assert.equal(installation.getSnapshot().task?.phase, 'done')
  assert.equal(installation.getSnapshot().notice, true)
  assert.equal(installation.getSnapshot().revision, 1)
  assert.deepEqual(counts(), { installs: 1, cancellations: 0 })
})

test('closing and reopening the dialog keeps one install running and refreshes the market on settlement', async () => {
  const { installation, pending, counts } = fixture()
  installation.start(target)
  const requestId = installation.getSnapshot().task!.requestId
  installation.progress({ requestId: 'another-request' as PluginInstallRequestId, phase: 'applying' })
  assert.equal(installation.getSnapshot().task?.phase, 'starting')
  installation.progress({ requestId, phase: 'installing' })
  installation.hide()
  assert.equal(installation.getSnapshot().open, false)
  assert.equal(installation.getSnapshot().task?.phase, 'installing')
  installation.start(target)
  assert.equal(installation.getSnapshot().open, true)
  installation.hide()
  assert.deepEqual(counts(), { installs: 1, cancellations: 0 })

  pending.resolve({ ok: true, value: applied })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(installation.getSnapshot().task?.phase, 'done')
  assert.equal(installation.getSnapshot().revision, 1)
  assert.equal(installation.getSnapshot().notice, true)
  assert.equal(installation.getSnapshot().open, false)
})

test('explicit cancellation waits for the Host and a late install reply cannot replace the outcome', async () => {
  const { installation, pending, counts } = fixture()
  installation.start(target)
  const requestId = installation.getSnapshot().task!.requestId
  installation.progress({ requestId, phase: 'installing' })
  await installation.cancel()
  pending.resolve({ ok: true, value: applied })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(installation.getSnapshot().task?.phase, 'cancelled')
  assert.deepEqual(counts(), { installs: 1, cancellations: 1 })
})

test('a lost install reply reconciles the original request without submitting another installation', async () => {
  const { installation, pending, counts } = fixture()
  installation.start(target)
  installation.hide()
  pending.reject(new Error('connection reset'))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(installation.getSnapshot().task?.phase, 'done')
  assert.deepEqual(counts(), { installs: 1, cancellations: 0 })
})
