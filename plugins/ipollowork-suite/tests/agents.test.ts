import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentStore, initialState, stateSchema, type AgentState } from '../src/host/agent-store.ts'
import { readFile } from 'node:fs/promises'

function fixture() {
  let state: AgentState = structuredClone(initialState)
  let failure: Error | undefined
  return {
    store: new AgentStore({ get: () => state, set: async (next: AgentState) => {
      if (failure) throw failure
      state = structuredClone(next)
    } }),
    fail(error: Error) { failure = error },
  }
}

test('one reusable definition keeps project memories separate across store reconstruction', async () => {
  let state: AgentState = structuredClone(initialState)
  const global = { get: () => state, set: async (value: AgentState) => { state = structuredClone(value) } }
  const store = new AgentStore(global)
  const agent = await store.saveAgent({ name: 'Research', prompt: 'Research carefully' }, [])
  await store.saveMemory('project-a', agent.id, 'A is about energy', 0)
  await store.saveMemory('project-b', agent.id, 'B is about education', 0)
  const restored = new AgentStore(global)
  assert.equal(restored.readMemory('project-a', agent.id).text, 'A is about energy')
  assert.equal(restored.readMemory('project-b', agent.id).text, 'B is about education')
  assert.equal(restored.snapshot().agents.length, 1)
})

test('concurrent edits reject a stale revision instead of losing another change', async () => {
  const { store } = fixture()
  const original = await store.saveAgent({ name: 'Writer' }, [])
  const results = await Promise.allSettled([
    store.saveAgent({ ...original, name: 'First editor' }, []),
    store.saveAgent({ ...original, name: 'Second editor' }, []),
  ])
  assert.equal(results[0]!.status, 'fulfilled')
  assert.equal(results[1]?.status, 'rejected'); if (results[1]?.status === 'rejected') assert.equal(results[1].reason.code, 'IPOLLO_STALE_REVISION')
  assert.equal(store.snapshot().agents[0]!.name, 'First editor')
  await store.saveMemory('a', original.id, 'First note', 0)
  await assert.rejects(store.saveMemory('a', original.id, 'Lost update', 0), { code: 'IPOLLO_STALE_REVISION' })
})

test('failed persistence leaves the last saved definition and memory intact', async () => {
  const f = fixture()
  const agent = await f.store.saveAgent({ name: 'Analyst' }, [])
  f.fail(new Error('disk full'))
  await assert.rejects(f.store.saveAgent({ ...agent, name: 'Not saved' }, []), /disk full/)
  assert.equal(f.store.snapshot().agents[0]!.name, 'Analyst')
  await assert.rejects(f.store.saveMemory('a', agent.id, 'Not saved', 0), /disk full/)
  assert.equal(f.store.readMemory('a', agent.id).revision, 0)
})

test('account tokens stay out of definitions and MCP references must exist', async () => {
  const { store } = fixture()
  const secrets = new Map<string, string>()
  const account = await store.addAccount('Work account', async ref => secrets.set(ref, 'private-test-token'))
  assert.equal(secrets.get(account.ref), 'private-test-token')
  const mcp = [{ serverName: 'work', transport: 'streamable-http' as const, url: 'https://mcp.example.test/api', accountId: account.id }]
  await store.saveAgent({ name: 'Connected', mcp }, [])
  assert.ok(!JSON.stringify(store.snapshot()).includes('private-test-token'))
  await assert.rejects(store.saveAgent({ name: 'Missing', mcp: [{ ...mcp[0]!, accountId: 'unknown' }] }, []), { code: 'IPOLLO_ACCOUNT_NOT_FOUND' })
})

test('invalid servers and malformed stored data fail before a definition is committed', async () => {
  const { store } = fixture()
  for (const url of ['file:///etc/passwd', 'https://user:password@example.test/mcp', 'bad-url']) {
    await assert.rejects(store.saveAgent({ name: 'Invalid', mcp: [{ serverName: 'server', transport: 'streamable-http', url }] }, []), { code: 'IPOLLO_INVALID_AGENT' })
  }
  assert.equal(store.snapshot().agents.length, 0)
  assert.equal(stateSchema.safeParse({ agents: [{ id: 'broken' }], accounts: [], memories: [] }).success, false)
})

test('disabling a definition preserves its project memories and stable identity', async () => {
  const { store } = fixture()
  const agent = await store.saveAgent({ name: 'Writer' }, [])
  await store.saveMemory('project', agent.id, 'Keep this', 0)
  const disabled = await store.saveAgent({ ...agent, enabled: false }, [])
  assert.equal(disabled.id, agent.id)
  assert.equal(disabled.enabled, false)
  assert.equal(store.readMemory('project', agent.id).text, 'Keep this')
})

test('service selections reuse names and preserve legacy definitions without requiring account setup', async () => {
  const { store } = fixture()
  const legacy = await store.saveAgent({ name: 'Existing assistant' }, [])
  assert.equal(legacy.serviceNames, undefined)
  const linked = await store.saveAgent({ name: 'Linked assistant', serviceNames: ['docs', 'docs', 'research'] }, [])
  assert.deepEqual(linked.serviceNames, ['docs', 'research'])
  assert.deepEqual(linked.mcp, [])
  assert.deepEqual(store.snapshot().accounts, [])
  await assert.rejects(store.saveAgent({ name: 'Invalid', serviceNames: ['with spaces'] }, []), { code: 'IPOLLO_INVALID_AGENT' })
})

test('avatar and model defaults survive reopening, older clients, and explicit removal', async () => {
  const { store } = fixture()
  const avatar = `data:image/png;base64,${(await readFile(new URL('./fixtures/avatar.png', import.meta.url))).toString('base64')}`
  const model = { provider: 'custom', model: 'work-model' }
  const created = await store.saveAgent({ name: 'Assistant', avatar, model }, [])
  const olderClient = await store.saveAgent({ id: created.id, revision: created.revision, name: 'Renamed' }, [])
  assert.equal(olderClient.avatar, avatar)
  assert.deepEqual(olderClient.model, model)
  const removed = await store.saveAgent({ ...olderClient, avatar: '', model: null }, [])
  assert.equal(removed.avatar, '')
  assert.equal(removed.model, null)
  assert.equal(store.snapshot().agents.length, 1)
  await assert.rejects(store.saveAgent({ ...removed, avatar: 'https://example.test/avatar.png' }, []), { code: 'IPOLLO_INVALID_AGENT' })
  assert.equal(store.snapshot().agents[0]?.avatar, '')
})
