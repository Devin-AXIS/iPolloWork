import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CredentialProvider, CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { applyBundle, packageFile } from '../src/ported/host.ts'
import { bundleAuthorization } from '../src/ported/credentials.ts'
import { manifestSchema } from '../src/ported/contracts.ts'
import { workspaceFile } from '../src/ported/media.ts'
import { publicAddress } from '../src/ported/download.ts'
import { Ajv2020 } from 'ajv/dist/2020.js'
import yaml from 'js-yaml'

function credentialFixture() {
  const records = new Map<CredentialKey, CredentialRecord>()
  const provider: Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'> = {
    readRecord: async key => records.get(key),
    modifyRecord: async (key, update) => { const value = await update(records.get(key)); if (value) records.set(key, value); return value },
    deleteRecord: async key => { records.delete(key) },
  }
  return { records, provider }
}
test('native credential records retain multi-account selection and isolate plugin owners', async () => {
  const { provider } = credentialFixture(), first = bundleAuthorization(provider, 'one'), second = bundleAuthorization(provider, 'two')
  await first.saveCredential('key', 'alice', { token: 'fixture-secret' })
  await first.saveCredential('key', 'bob', { token: 'second-secret' })
  assert.equal((await first.getCredential('key'))?.token, 'fixture-secret')
  assert.equal(await second.getCredential('key'), null)
  assert(!JSON.stringify(await first.listConnections()).includes('secret'))
  assert.equal(await first.setActiveAccount('key', 'bob'), true)
  assert.equal((await first.getCredential('key'))?.token, 'second-secret')
  assert.equal(await first.setActiveAccount('key', 'missing'), false)
  await first.revokeAccount('bob')
  assert.equal(await first.readCredential('bob', 'key'), null)
})

test('all former plugin identities map to native packages with complete port metadata', async () => {
  const repository = fileURLToPath(new URL('../../..', import.meta.url))
  const inventory = JSON.parse(await readFile(join(repository, 'integrations/runtime/ported-plugins.json'), 'utf8')) as { plugins: { id: string; name: string; kind: string }[] }
  const archives = join(repository, 'plugins/ipollowork-suite/catalog/packages')
  const releases = JSON.parse(await readFile(join(archives, '../bundled-releases.json'), 'utf8')) as { plugins: { name: string; file: string }[] }
  assert.equal(inventory.plugins.length, 24)
  assert.equal(new Set(inventory.plugins.map(item => item.id)).size, 24)
  for (const item of inventory.plugins.filter(item => item.kind !== 'existing-native')) {
    const directory = join(repository, 'plugins', item.id)
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'business/ipollowork.plugin.json'), 'utf8')))
    assert.equal(manifest.id, item.id)
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.equal(pkg.name, item.name)
    const release = releases.plugins.find(release => release.name === item.name)
    assert(release, `Missing shipping archive: ${item.name}`)
    const shipped = new Set(execFileSync('tar', ['-tzf', release.file], { cwd: archives, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim().split(/\r?\n/))
    assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
    assert.deepEqual(yaml.load(await readFile(join(directory, 'cordis.patch.yml'), 'utf8')), [{ insert: [{ id: 'ipollo-' + item.id, name: item.name }] }])
    const validator = new Ajv2020({ strict: false, validateFormats: false })
    for (const resource of manifest.resources) for (const action of resource.actions ?? []) assert.doesNotThrow(() => validator.compile(action.inputSchema), `${item.id}/${action.id}`)
    for (const resource of manifest.resources) {
      if (!['skill', 'ui', 'mcp', 'local-service', 'file', 'command', 'agent'].includes(resource.type)) continue
      const path = resource.type === 'skill' && !resource.path.endsWith('.md') ? resource.path + '/SKILL.md' : resource.path
      const member = 'package/business/' + path.replace(/\.ts$/, '.js').replaceAll('\\', '/')
      assert(shipped.has(member) || [...shipped].some(file => file.startsWith(member + '/')), `${item.id}: resource missing from shipping archive: ${path}`)
    }
  }
})

test('ported Host enforces owner admission, exact action schemas, workspace membership and read-only sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-ported-test-'))
  const originalDataRoot = process.env.IPW_PORTED_DATA_ROOT; process.env.IPW_PORTED_DATA_ROOT = join(dir, 'data')
  const disposers: (() => void | Promise<void>)[] = [], tools = new Map<string, ToolDefinition>()
  const { provider } = credentialFixture()
  let route: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined, readonly = false, disposed = false
  const server = createServer((req, res) => { if (!route) { res.writeHead(404); res.end(); return }; void route(req, res) })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address(); assert(address && typeof address !== 'string')
  const origin = 'http://127.0.0.1:' + address.port
  const workbench = createServer((req, res) => {
    if (req.url?.startsWith('/entry')) { res.writeHead(302, { location: '/publishing?token=private-fixture-token' }); res.end(); return }
    res.setHeader('content-type', 'text/html')
    res.end('<html><head><script src="/app.js"></script></head><body>Workbench</body></html>')
  })
  await new Promise<void>(done => workbench.listen(0, '127.0.0.1', done))
  const workbenchAddress = workbench.address(); assert(workbenchAddress && typeof workbenchAddress !== 'string')
  const workspace = join(dir, 'workspace'); await mkdir(workspace)
  const ctx = {
    credentials: provider, get: () => undefined,
    workspaceRegistry: { list: () => [{ id: 'w', title: 'Workspace', path: workspace, sessionIds: ['session'] }] },
    sandboxPolicy: { resolve: () => ({ mode: readonly ? 'read-only' : 'workspace-write' }) },
    connection: { admit: (req: IncomingMessage) => req.headers.cookie === 'owner=test' ? { peer: { principal: { kind: 'owner' } } } : { rejection: 401 } },
    effect: (setup: () => void | (() => void | Promise<void>)) => { const off = setup(); if (off) disposers.push(off) },
    tools: { register: (tool: ToolDefinition) => { tools.set(tool.name, tool); return () => { tools.delete(tool.name); disposed = true } } },
    webServer: { getOrigin: () => origin, register: (value: { handler: typeof route }) => { route = value.handler; return () => { route = undefined } } },
  } as unknown as Context
  const manifest = { id: 'fixture-plugin', name: 'Fixture', description: 'Fixture plugin', package: { version: '1' }, resources: [{ id: 'service', type: 'local-service', path: 'service.mjs', actions: [
    { id: 'read', effect: 'read', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } },
    { id: 'write', effect: 'write', inputSchema: { type: 'object', additionalProperties: false } },
    { id: 'open-workbench', effect: 'read', inputSchema: { type: 'object', additionalProperties: false } },
  ] }] }
  await writeFile(join(dir, 'service.mjs'), `export default function(){return {actions:{read:input=>({value:input.value}),write:()=>({saved:true}),'open-workbench':()=>({url:'http://127.0.0.1:${workbenchAddress.port}/entry?token=private-fixture-token'})},dispose(){}}}`)
  try {
    await applyBundle(ctx, manifest, dir)
    const base = origin + '/ipollo-ported/fixture-plugin'
    assert.equal((await fetch(base + '/state')).status, 401)
    const headers = { cookie: 'owner=test', 'content-type': 'application/json' }
    assert.equal((await fetch(base + '/credential', { method: 'POST', headers: { ...headers, origin: 'https://foreign.test' }, body: '{}' })).status, 403)
    const call = (payload: unknown) => fetch(base + '/call', { method: 'POST', headers, body: JSON.stringify(payload) })
    const payload = { workspace: 'w', resource: 'service', action: 'read', input: { value: 'preserved' } }
    assert.deepEqual(await (await call(payload)).json(), { value: 'preserved' })
    assert.equal((await call({ ...payload, workspace: 'other' })).status, 400)
    assert.equal((await call({ ...payload, sessionId: 'foreign-session' })).status, 400)
    assert.equal((await call({ ...payload, input: { value: 42 } })).status, 400)
    assert.equal((await call({ ...payload, input: { value: 'ok', extra: true } })).status, 400)
    const opened = await (await call({ workspace: 'w', resource: 'service', action: 'open-workbench', input: {} })).json() as { url: string }
    assert(!opened.url.includes('private-fixture-token'))
    const redirected = await fetch(origin + opened.url, { headers, redirect: 'manual' })
    assert.equal(redirected.status, 302)
    assert.equal(redirected.headers.get('location'), '/ipollo-ported/fixture-plugin/workbench/w/publishing')
    const page = await fetch(origin + redirected.headers.get('location'), { headers })
    const html = await page.text()
    assert(html.includes('src="/ipollo-ported/fixture-plugin/workbench/w/app.js"'))
    assert(html.includes('parent.document.body'))
    assert(page.headers.get('content-security-policy')?.includes("frame-ancestors 'self'"))
    const tool = tools.get('ipollo_fixture_plugin'); assert(tool)
    const exec = { agent: { session: { id: 'session', header: { cwd: workspace } } }, signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]
    readonly = true
    assert.deepEqual(await tool.execute({ resource: 'service', action: 'read', input: { value: 'read-only' } }, exec), { value: 'read-only' })
    await assert.rejects(Promise.resolve().then(() => tool.execute({ resource: 'service', action: 'write', input: {} }, exec)), /not available/)
    for (const off of disposers.reverse()) await off()
    assert.equal(disposed, true); assert.equal(tools.size, 0); assert.equal((await fetch(base + '/state', { headers })).status, 404)
  } finally {
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
    workbench.closeAllConnections(); await new Promise<void>(done => workbench.close(() => done()))
    if (originalDataRoot === undefined) delete process.env.IPW_PORTED_DATA_ROOT; else process.env.IPW_PORTED_DATA_ROOT = originalDataRoot
    await rm(dir, { recursive: true, force: true })
  }
})

test('workspace reads and writes reject traversal and linked paths, media DNS excludes local addresses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-ported-paths-'))
  try {
    const root = join(dir, 'workspace'); await mkdir(root)
    await assert.rejects(workspaceFile(root, '../secret'))
    const outside = join(dir, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret'), 'private')
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(workspaceFile(root, 'linked/secret'))
    await assert.rejects(workspaceFile(root, 'linked/output/file', true))
    assert.equal(publicAddress('127.0.0.1'), false); assert.equal(publicAddress('169.254.169.254'), false)
    assert.equal(publicAddress('::1'), false); assert.equal(publicAddress('10.1.2.3'), false); assert.equal(publicAddress('8.8.8.8'), true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
