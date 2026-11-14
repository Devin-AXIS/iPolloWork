import test from 'node:test'
import assert from 'node:assert/strict'

test('the fixed web entry resumes its own chat and starts new chats in coordinator mode', { skip: !process.env.IPOLLO_QA_URL, timeout: 30000 }, async () => {
  const url = new URL(process.env.IPOLLO_QA_URL!)
  const login = await fetch(url, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const open = async (fresh: boolean) => {
    const response = await fetch(url.origin + '/ipollowork-suite/agents/coordinator', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ fresh }) })
    const value = await response.json() as { sessionId: string; agentPreset: string }
    assert.equal(response.status, 200, JSON.stringify(value))
    assert.equal(value.agentPreset, 'ipollo-coordinator')
    return value
  }
  const first = await open(true)
  assert.deepEqual(await open(false), first)
  const second = await open(true)
  assert.notEqual(second.sessionId, first.sessionId)
  assert.deepEqual(await open(false), second)
  const denied = await fetch(url.origin + '/ipollowork-suite/agents/coordinator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(denied.status, 401)
  const invalid = await fetch(url.origin + '/ipollowork-suite/agents/coordinator', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"fresh":"yes"}' })
  assert.equal(invalid.status, 400)
})
