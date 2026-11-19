import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Config as McpConfig, probeServer } from '@deepseek-ai/dsh-mcp-client'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { mountEnterpriseMcp, type EnterpriseMcpScope } from '../src/host/enterprise-mcp.ts'
import type { ModelWebServer } from '../src/host/service-models.ts'

test('granted MCP connections appear with native status, reconnect through the manager, and withdraw on revocation', async () => {
  const id = '00000000-0000-4000-8000-000000000001'
  let granted = true
  let signedIn = true, catalogFailure = false
  const requests: string[] = []
  const effects: Array<() => void | Promise<void>> = []
  const live = new Map<string, object>(), restarts: string[] = []
  const account = new AccountService({ readRecord: async () => signedIn ? ({ kind: 'grant', payload: { version: 1, origin: 'https://account.test', token: 'test-session' } }) : undefined,
    modifyRecord: async () => undefined, deleteRecord: async () => {} }, resolveConfig({ accountOrigin: 'https://account.test' }), new AbortController().signal,
    async input => {
      const path = new URL(String(input)).pathname
      requests.push(path)
      if (catalogFailure) return Response.json({ code: 'MCP_CATALOG_UNAVAILABLE' }, { status: 503 })
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
    assert.deepEqual(requests, ['/api/v1/me/enterprise-mcp'], 'MCP discovery must not depend on balance or extra session requests')
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
    catalogFailure = true
    await assert.rejects(bridge(), { code: 'MCP_CATALOG_UNAVAILABLE' })
    catalogFailure = false
    signedIn = false
    const beforeSignOut = requests.length
    await bridge()
    assert.deepEqual(bridge.connections(), [])
    assert.equal(requests.length, beforeSignOut, 'signed-out discovery must not send a request')
  } finally { for (const off of effects.reverse()) await off() }
});

test('organization relay preserves protocol headers and native discovery falls back to a legacy MCP', async () => {
  const id = '00000000-0000-4000-8000-000000000002'
  const effects: Array<() => void | Promise<void>> = []
  const live = new Map<string, Parameters<EnterpriseMcpScope['mcpManager']['register']>[1]>()
  const methods: string[] = []
  let handler: Parameters<ModelWebServer['register']>[0]['handler'] | undefined
  const server = createServer((req, res) => {
    if (!handler) { res.writeHead(503); res.end(); return }
    void handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  assert.ok(address && typeof address !== 'string')
  const account = new AccountService({ readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: 'https://account.test', token: 'test-session' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {} }, resolveConfig({ accountOrigin: 'https://account.test' }), new AbortController().signal,
    async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/auth/get-session') return Response.json({ user: { id: 'member', name: 'Member', email: 'member@example.test' } })
      if (path === '/api/v1/me/summary') return Response.json({ points: { balance: 1 } })
      if (path === '/api/v1/me/enterprise-mcp') return Response.json({ items: [{ id, title: 'Legacy MCP' }] })
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-session')
      if (init?.method === 'GET') return new Response(null, { status: 405 })
      assert.ok(init?.body instanceof Uint8Array)
      const request = JSON.parse(Buffer.from(init.body).toString()) as { id?: number; method: string }
      methods.push(request.method)
      if (request.method === 'server/discover') {
        assert.equal(new Headers(init?.headers).get('mcp-method'), 'server/discover')
        return Response.json({ code: 'MCP_UPSTREAM_REJECTED' }, { status: 400 })
      }
      if (request.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'legacy-fixture', version: '1.0.0' },
      } })
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 })
      assert.equal(request.method, 'tools/list')
      return Response.json({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'ping', inputSchema: { type: 'object', properties: {} } }] } })
    })
  const scope = new Context().extend({
    effect(run: () => () => void | Promise<void>) { const off = run(); effects.push(off); return off },
  })
  const bridge = mountEnterpriseMcp({ effect: scope.effect.bind(scope), mcpManager: {
    register(name, entry) { live.set(name, entry); return () => { live.delete(name) } },
    list: () => [], restart: async () => {},
  } }, { register(route) { handler = route.handler; return () => { handler = undefined } }, getOrigin: () => `http://127.0.0.1:${address.port}` }, account)
  try {
    await bridge()
    const registered = Array.from(live)[0]
    assert.ok(registered)
    const [name, entry] = registered
    const result = await probeServer(new Context(), McpConfig({ ...entry, serverName: name, closeTimeoutMs: 1000 }), { timeoutMs: 5000 })
    assert.equal(result.ok, true, JSON.stringify(result))
    if (result.ok) assert.deepEqual(result.toolNames, ['ping'])
    assert.deepEqual(methods, ['server/discover', 'initialize', 'notifications/initialized', 'tools/list'])
  } finally {
    for (const off of effects.reverse()) await off()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
