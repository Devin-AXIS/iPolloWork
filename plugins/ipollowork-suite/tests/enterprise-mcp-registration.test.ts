import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { mountEnterpriseMcp } from '../src/host/enterprise-mcp.ts'

test('granted MCP connections appear with native status, reconnect through the manager, and withdraw on revocation', async () => {
  const id = '00000000-0000-4000-8000-000000000001'
  let granted = true
  const effects: Array<() => void | Promise<void>> = []
  const live = new Map<string, object>(), restarts: string[] = []
  const account = new AccountService({ readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: 'https://account.test', token: 'test-session' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {} }, resolveConfig({ accountOrigin: 'https://account.test' }), new AbortController().signal,
    async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/auth/get-session') return Response.json({ user: { id: 'member', name: 'Member', email: 'member@example.test' } })
      if (path === '/api/v1/me/summary') return Response.json({ points: { balance: 1 } })
      return Response.json({ items: granted ? [{ id, title: '团队搜索' }] : [] })
    })
  const manager = {
    register(name: string, entry: object) { live.set(name, entry); return () => { live.delete(name) } },
    list: () => Array.from(live.keys(), name => ({ name, status: { state: 'connected' } })),
    restart: async (name: string) => { restarts.push(name) },
  };
  const scope = new Context().extend({
    effect(run: () => () => void | Promise<void>) { const off = run(); effects.push(off); return off },
  })
  const bridge = mountEnterpriseMcp({ effect: scope.effect.bind(scope), mcpManager: manager }, { register: () => () => {}, getOrigin: () => 'http://127.0.0.1:1234' }, account)
  try {
    await bridge()
    const connection = bridge.connections()[0]!
    assert.equal(connection.title, '团队搜索')
    assert.equal(connection.state, 'connected')
    assert.ok(connection.serverName.length <= 32)
    assert.ok(!JSON.stringify(bridge.connections()).includes('test-session'))
    await bridge.restart(id)
    assert.deepEqual(restarts, [connection.serverName])
    granted = false
    await bridge()
    assert.equal(live.size, 0)
    await assert.rejects(bridge.restart(id), { code: 'IPW_MCP_FORBIDDEN' })
  } finally { for (const off of effects.reverse()) await off() }
});
