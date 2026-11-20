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
    return Response.json(next ?? { error: 'IPW_SERVICE_UNAVAILABLE' }, { status: next ? 200 : 503 })
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

test('refresh retries organization records even if refreshing the cached list fails', async () => {
  const server = serve([catalog(['a']), catalog(['a'])])
  const controller = new EnterpriseController()
  try {
    controller.accountChanged(true)
    await controller.load()
    const previous = controller.getSnapshot()
    await controller.load()
    const failed = controller.getSnapshot()
    assert.equal(failed.catalog, previous.catalog)
    assert.equal(failed.error, 'IPW_SERVICE_UNAVAILABLE')
    assert.equal(failed.revision, previous.revision + 1)
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

test('opening the bell preserves unread notices until the explicit mark-all action', async () => {
  const original = globalThis.fetch, writes: unknown[] = []
  let read = false
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith('/notices')) return Response.json(catalog(['a']))
    if (init?.method === 'PUT') { writes.push(JSON.parse(String(init.body))); read = true; return Response.json({ ok: true }) }
    return Response.json({ unreadCount: read ? 0 : 102, items: Array.from({ length: 100 }, (_, i) => ({
      id: String(i), kind: 'role', name: 'Team', value: 'member', createdAt: 1, readAt: read ? 2 : null,
    })) })
  }
  const controller = new EnterpriseController()
  try {
    controller.accountChanged(true)
    await controller.openNotices()
    assert.deepEqual(writes, [])
    assert.equal(controller.getSnapshot().memberNotices?.unreadCount, 102)
    await controller.readNotices({ all: true })
    assert.deepEqual(writes, [{ all: true }])
    assert.equal(controller.getSnapshot().memberNotices?.unreadCount, 0)
    await controller.openNotices()
    assert.equal(writes.length, 1)
  } finally { controller.dispose(); globalThis.fetch = original }
})

test('legacy notice feeds use exact unread ids and failed acknowledgements remain visible and retryable', async () => {
  const original = globalThis.fetch, writes: unknown[] = []
  let reject = true, read = false
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith('/notices')) return Response.json(catalog(['a']))
    if (init?.method === 'PUT') {
      writes.push(JSON.parse(String(init.body)))
      if (reject) return Response.json({ error: 'DATABASE_UNAVAILABLE' }, { status: 503 })
      read = true; return Response.json({ ok: true })
    }
    return Response.json({ items: [
      { id: 'unread', kind: 'role', name: 'Team', value: null, createdAt: 1, readAt: read ? 2 : null },
      { id: 'read', kind: 'role', name: 'Team', value: null, createdAt: 1, readAt: 2 },
    ] })
  }
  const controller = new EnterpriseController()
  try {
    controller.accountChanged(true)
    await controller.openNotices()
    await assert.rejects(controller.readNotices({ ids: ['unread'] }), { message: 'DATABASE_UNAVAILABLE' })
    assert.equal(controller.getSnapshot().memberNotices?.items[0]?.readAt, null)
    reject = false
    await controller.readNotices({ ids: ['unread'] })
    assert.deepEqual(writes, [{ ids: ['unread'] }, { ids: ['unread'] }])
    assert.equal(controller.getSnapshot().memberNoticeError, '')
    assert.equal(controller.getSnapshot().memberNotices?.items[0]?.readAt, 2)
  } finally { controller.dispose(); globalThis.fetch = original }
})

test('an account switch while opening the bell cannot acknowledge another account', async () => {
  const original = globalThis.fetch
  let finish: (response: Response) => void = () => {}, writes = 0
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith('/notices')) return Response.json(catalog(['a']))
    if (init?.method === 'PUT') { writes++; return Response.json({ ok: true }) }
    return new Promise(resolve => { finish = resolve })
  }
  const controller = new EnterpriseController()
  try {
    controller.accountChanged(true)
    const opening = controller.openNotices()
    controller.accountChanged(true)
    finish(Response.json({ unreadCount: 1, items: [] }))
    await opening
    assert.equal(writes, 0)
    assert.equal(controller.getSnapshot().memberNotices, null)
  } finally { controller.dispose(); globalThis.fetch = original }
})

test('a conversation notice resolves the exact authorized record before navigation and acknowledgement', async () => {
  const original = globalThis.fetch, operations: string[] = [];
  let available = false, shown = false;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith('/organizations/team/messages/share')) {
      operations.push('authorize');
      return available ? Response.json({ id: 'share' }) : Response.json({ error: 'SHARE_NOT_FOUND' }, { status: 404 });
    }
    if (path.endsWith('/notices') && init?.method === 'PUT') {
      operations.push('acknowledge');
      return Response.json({ ok: true });
    }
    if (path.endsWith('/notices')) return Response.json({ items: [] });
    return Response.json(catalog(['team']));
  };
  const controller = new EnterpriseController();
  const notice = { id:'notice', kind:'conversation.shared', name:'Team', value:'Chat', createdAt:1, readAt:null,
    enterpriseId:'team', tab:'messages' as const, targetId:'share' };
  try {
    controller.accountChanged(true);
    await assert.rejects(controller.openOrganizationNotice(notice, () => { shown = true; }), { message:'SHARE_NOT_FOUND' });
    assert.equal(shown, false);
    assert.deepEqual(operations, ['authorize']);
    available = true;
    await controller.openOrganizationNotice(notice, () => { shown = true; operations.push('navigate'); });
    assert.equal(controller.getSnapshot().tab, 'messages');
    assert.equal(controller.getSnapshot().publicationTarget, 'share');
    assert.deepEqual(operations, ['authorize', 'authorize', 'navigate', 'acknowledge']);
  } finally { controller.dispose(); globalThis.fetch = original; }
});
