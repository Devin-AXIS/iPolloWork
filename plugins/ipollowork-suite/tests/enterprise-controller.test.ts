import test from 'node:test'
import assert from 'node:assert/strict'
import { EnterpriseController } from '../src/client/enterprise-controller.ts'
import type { EnterpriseCatalog } from '../src/shared/enterprise.ts'

const catalog = (ids: string[]): EnterpriseCatalog => ({ serviceOrigin: 'https://account.test', userId: 'me', work: [], sharedProjects: [], projects: [], shares: [],
  enterprises: ids.map(id => ({ id, name: id, role: 'member', memberCount: 1 })) })

function serve(responses: EnterpriseCatalog[]) {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input))
    const next = responses.shift()
    return new Response(JSON.stringify(next), { status: next ? 200 : 503, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('the selected enterprise survives reloads and falls back when the member leaves it', async () => {
  // accountChanged starts its own load, which the explicit load supersedes.
  const server = serve([catalog(['a', 'b']), catalog(['a', 'b']), catalog(['a', 'b']), catalog(['a'])])
  const controller = new EnterpriseController()
  try {
    controller.accountChanged(true)
    await controller.load()
    assert.equal(controller.getSnapshot().enterpriseId, 'a')
    controller.selectEnterprise('b')
    await controller.load()
    assert.equal(controller.getSnapshot().enterpriseId, 'b')
    await controller.load()
    assert.equal(controller.getSnapshot().enterpriseId, 'a')
  } finally { controller.dispose(); server.restore() }
})

test('record views form a stack that tabs and enterprise switches reset', () => {
  const controller = new EnterpriseController()
  controller.open({ kind: 'continue', shareId: 'share' })
  controller.push({ kind: 'project', id: 'project' })
  assert.equal(controller.getSnapshot().dialog, null)
  controller.push({ kind: 'work', id: 'work' })
  controller.back()
  assert.deepEqual(controller.getSnapshot().views, [{ kind: 'project', id: 'project' }])
  controller.selectTab('members')
  assert.deepEqual(controller.getSnapshot().views, [])
  controller.show({ kind: 'share', id: 'share' })
  controller.selectEnterprise('other')
  assert.deepEqual(controller.getSnapshot().views, [])
  controller.dispose()
})

test('window focus does not reload a catalog that was just read, and each mutation reload advances the record revision', async () => {
  const server = serve([catalog(['a']), catalog(['a']), catalog(['a'])])
  const controller = new EnterpriseController()
  try {
    controller.accountChanged(true)
    await controller.load()
    const revision = controller.getSnapshot().revision
    controller.refreshIfStale()
    assert.equal(server.calls.length, 2)
    await controller.load()
    assert.equal(controller.getSnapshot().revision, revision + 1)
  } finally { controller.dispose(); server.restore() }
})

test('toasts are replaced by newer ones and only the current toast can be dismissed', () => {
  const controller = new EnterpriseController()
  controller.notify('first')
  const first = controller.getSnapshot().toast!.id
  controller.notify('second')
  controller.dismissToast(first)
  assert.equal(controller.getSnapshot().toast?.text, 'second')
  controller.dismissToast(controller.getSnapshot().toast!.id)
  assert.equal(controller.getSnapshot().toast, null)
  controller.dispose()
})
