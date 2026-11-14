import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import packageInfo from '../package.json' with { type: 'json' }
import { apply, type HostContext } from '../src/host/index.ts'
import type { Decision, ToolCall } from '../src/host/management.ts'

test('the route requires native owner authorization and disappears when its plugin unloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-host-'))
  const anchor = join(dir, 'package.json')
  await writeFile(anchor, JSON.stringify({ version: '0.2.2-rc.2' }))
  let handler: ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined
  let guard: ((call: ToolCall, next: () => Promise<Decision>) => Promise<Decision>) | undefined
  const disposers: (() => void)[] = []
  const ctx: HostContext = {
    effect: setup => { const dispose = setup(); if (dispose) disposers.push(dispose) },
    on: (_name, listener) => { if (_name === 'tools/pre-execute') guard = listener as NonNullable<typeof guard>; const off = () => { guard = undefined }; disposers.push(off); return off },
    fiber: { entry: { id: 'entry:suite' } },
    webServer: { register: route => { handler = route.handler; return () => { handler = undefined } } },
    connection: { requestRejection: request => request.headers.cookie === 'owner=test' ? undefined : 401 },
    credentials: { readRecord: async () => undefined, modifyRecord: async () => undefined, deleteRecord: async () => {} },
    pluginManager: { listBundles: async () => [] }, profileContext: { installAnchor: anchor, home: dir },
    workspaceRegistry: { list: () => [] }, sessionQuery: { readSurface: async () => ({ events: [] }) },
  }
  apply(ctx, { catalogPath: resolve('catalog/index.json') })
  const server = createServer((request, response) => {
    if (handler) void handler(request, response)
    else { response.statusCode = 404; response.end() }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/ipollowork-suite`
  try {
    assert.equal((await fetch(base + '/info')).status, 401)
    assert.equal((await fetch(base + '/account/sign-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
    const info = await fetch(base + '/info', { headers: { Cookie: 'owner=test' } })
    assert.equal((await info.json()).version, packageInfo.version)
    const account = await fetch(base + '/account', { headers: { Cookie: 'owner=test' } })
    assert.deepEqual(await account.json(), { status: 'anonymous', origin: 'http://localhost:4785' })
    assert(guard)
    assert.equal((await guard({ name: 'plugin_manager', arguments: { action: 'remove_bundle', target: '@ipollo/dsh-suite' } }, async () => ({ kind: 'allow' }))).kind, 'deny')
    for (const dispose of disposers.reverse()) dispose()
    assert.equal((await fetch(base + '/info', { headers: { Cookie: 'owner=test' } })).status, 404)
    assert.equal(guard, undefined)
  } finally {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    await rm(dir, { recursive: true, force: true })
  }
})
