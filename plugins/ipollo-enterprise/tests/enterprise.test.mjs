import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EnterpriseConnector, enterpriseOrigin, RECORD_KEY } from '../enterprise.js'

/** The serialization contract of DSH's native credential-record provider. */
function credentialStore() {
  let record
  let queue = Promise.resolve()
  return {
    readRecord: async key => { assert.equal(key, RECORD_KEY); await queue; return record },
    modifyRecord: async (key, mutate) => {
      assert.equal(key, RECORD_KEY)
      const operation = queue.then(async () => { record = await mutate(record); return record })
      queue = operation.catch(() => {})
      return operation
    },
  }
}

test('company URL validation keeps proxy prefixes and rejects unsafe or misleading origins', () => {
  assert.equal(enterpriseOrigin(' http://192.168.1.2:4320/ '), 'http://192.168.1.2:4320')
  assert.equal(enterpriseOrigin('https://company.example/enterprise/'), 'https://company.example/enterprise')
  for (const value of ['http://company.example', 'http://localhost.evil.example', 'http://127.evil.example',
    'http://10.evil.example', 'http://192.168.evil.example', 'http://172.16.evil.example', 'file:///tmp/a',
    'https://admin:password@company.example', 'https://company.example?token=secret', 'https://company.example#secret', 'http://0.0.0.0:4320']) {
    assert.throws(() => enterpriseOrigin(value), undefined, value)
  }
})

test('discovery rejects a normal website without attempting account login', async () => {
  const calls = []
  const connector = new EnterpriseConnector(credentialStore(), async url => {
    calls.push(url); return Response.json({ title: 'Unrelated website' })
  })
  await assert.rejects(connector.join({ origin: 'https://company.example', accountOrigin: 'https://account.example',
    email: 'member@example.test', password: 'password', joinCode: 'ABCDE-23456' }), { code: 'incompatible_enterprise' })
  assert.deepEqual(calls, ['https://company.example/.well-known/ipollo-enterprise'])
  assert.deepEqual(await connector.list(), [])
})

test('a public HTTP account provider requires explicit consent and is never an automatic HTTPS fallback', async () => {
  const calls = []
  const connector = new EnterpriseConnector(credentialStore(), async (url, init) => {
    calls.push({ url, method: init.method })
    if (url.endsWith('/.well-known/ipollo-enterprise')) return Response.json({ serverId: 'ent_fixture', name: 'Fixture', authMode: 'ipollo_oidc' })
    return Response.json({ error: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 })
  })
  const input = { origin: 'https://company.example', accountOrigin: 'http://account.example',
    email: 'member@example.test', password: 'fixture-password', joinCode: 'ABCDE-23456' }
  await assert.rejects(connector.join(input), { code: 'https_required' })
  assert.equal(calls.length, 0)
  await assert.rejects(connector.join({ ...input, allowInsecureAccount: true }), { code: 'INVALID_EMAIL_OR_PASSWORD' })
  assert.deepEqual(calls.map(call => call.url), ['https://company.example/.well-known/ipollo-enterprise', 'http://account.example/api/auth/sign-in/email'])
  assert.deepEqual(await connector.list(), [])
})

test('credentials and raw provider error messages never become UI connection data', async () => {
  const store = credentialStore()
  await store.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: { version: 1, connections: [{
    id: 'connection', enterpriseId: 'ent_company', name: 'Company', memberId: 'member',
    email: 'member@example.test', origin: 'https://company.example', accountOrigin: 'https://account.example',
    role: 'member', status: 'active', token: 'private-enterprise-token', expiresAt: '2030-01-01T00:00:00.000Z',
  }] } }))
  const connector = new EnterpriseConnector(store, async () => Response.json({ error: 'password=secret token=private' }, { status: 500 }))
  assert.ok(!JSON.stringify(await connector.list()).includes('private-enterprise-token'))
  await assert.rejects(connector.refresh('connection'), { code: 'enterprise_unavailable' })
  await connector.disconnect('connection')
  assert.deepEqual(await connector.list(), [])
})

const osRoot = process.env.IPOLLO_OS_SOURCE

test('joins the real OS/PGlite enterprise API, survives reload, and enforces live membership changes',
  { skip: !osRoot && 'Set IPOLLO_OS_SOURCE to a built iPolloOS checkout', timeout: 90000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-enterprise-api-'))
    const cleanup = [() => rm(directory, { recursive: true, force: true })]
    t.after(async () => {
      const failures = []
      for (const dispose of cleanup.reverse()) {
        try { await dispose() } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, 'Enterprise fixture cleanup failed')
    })
    const { createEmbeddedEnterprise } = await import(pathToFileURL(join(osRoot, 'resources/enterprise-runtime/embedded.mjs')).href)
    const runtime = createEmbeddedEnterprise({ directory, migrations: join(osRoot, 'vendor/enterprise/drizzle') })
    cleanup.push(() => runtime.close())
    const space = { id: randomUUID(), name: 'DSH integration enterprise' }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'dsh-fixture', alg: 'EdDSA', use: 'sig' }
    let origin
    const email = 'dsh-member@example.test'
    const password = 'fixture-password-never-persisted'
    let accountRequests = 0
    const listen = server => {
      cleanup.push(() => new Promise((resolve, reject) => {
        if (!server.listening) { resolve(); return }
        server.closeAllConnections()
        server.close(error => error ? reject(error) : resolve())
      }))
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
      })
    }
    const accountServer = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      const send = (value, status = 200) => { response.writeHead(status); response.end(JSON.stringify(value)) }
      if (request.url === '/api/auth/jwks') return send({ keys: [jwk] })
      if (request.url === '/api/auth/sign-in/email') {
        accountRequests++
        let text = ''; for await (const chunk of request) text += chunk
        const input = JSON.parse(text)
        return input.email === email && input.password === password ? send({ token: 'fixture-account-bearer-token' })
          : send({ error: 'INVALID_EMAIL_OR_PASSWORD' }, 401)
      }
      if (request.url === '/api/auth/token' && request.headers.authorization === 'Bearer fixture-account-bearer-token') {
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
        const content = encode({ alg: 'EdDSA', typ: 'JWT', kid: 'dsh-fixture' }) + '.' + encode({
          iss: accountOrigin, aud: 'ipollo-enterprise', sub: 'fixture-dsh-user', email, name: 'DSH Member',
          exp: Math.floor(Date.now() / 1000) + 300,
        })
        return send({ token: content + '.' + sign(null, Buffer.from(content), privateKey).toString('base64url') })
      }
      send({ error: 'unauthorized' }, 401)
    })
    const accountOrigin = await listen(accountServer)
    const companyServer = createServer(async (request, response) => {
      try {
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const result = await runtime.api(space, request.url, {
          method: request.method, headers: request.headers,
          ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(chunks) }),
        }, undefined, { origin, accountIssuer: accountOrigin, clientOnly: true })
        response.writeHead(result.status, Object.fromEntries(result.headers))
        response.end(Buffer.from(await result.arrayBuffer()))
      } catch { response.writeHead(500).end() }
    })
    origin = await listen(companyServer)
    const management = async (operation, input, id) => {
      const response = await runtime.request(space, '', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, input, id }) })
      const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data
    }
    {
      const overviewResponse = await runtime.request(space, 'view=overview')
      const overview = await overviewResponse.json()
      assert.equal(overviewResponse.status, 200)
      const department = await management('department', { name: 'Engineering', parentId: null })
      const invitation = await management('invite', { email, role: 'admin' })
      const store = credentialStore()
      const connector = new EnterpriseConnector(store)
      const input = { origin, accountOrigin, email, password, joinCode: overview.join.code }
      await assert.rejects(connector.join({ ...input, joinCode: 'AAAAA-22222' }), { code: 'JOIN_CODE_NOT_FOUND' })
      assert.deepEqual(await connector.list(), [])
      await assert.rejects(connector.join({ ...input, password: 'wrong-password' }), { code: 'INVALID_EMAIL_OR_PASSWORD' })
      const connection = await connector.join(input)
      assert.equal(connection.memberId, invitation.id)
      assert.equal(connection.role, 'admin')
      assert.equal(connection.name, space.name)
      assert.equal(connection.origin, origin)
      const stored = await store.readRecord(RECORD_KEY)
      assert.ok(stored.payload.connections[0].token.length > 32)
      assert.ok(!JSON.stringify(stored).includes(password))
      assert.ok(!JSON.stringify(stored).includes('fixture-account-bearer-token'))
      assert.ok(!JSON.stringify(connection).includes(stored.payload.connections[0].token))
      const reloaded = new EnterpriseConnector(store)
      assert.equal((await reloaded.refresh(connection.id)).memberId, invitation.id)
      assert.ok((await reloaded.directory(connection.id, 'members')).items.some(member => member.id === invitation.id))
      assert.ok((await reloaded.directory(connection.id, 'departments')).items.some(item => item.id === department.id))
      if (process.env.DSH_NATIVE_PROOF_HOME) await t.test('native DSH loads the plugin, keeps credentials on the Host, and creates an original workspace', async () => {
        const log = await readFile(join(process.env.DSH_NATIVE_PROOF_HOME, 'server.log'), 'utf8')
        const start = log.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_%.-]+/)?.[0]
        assert.ok(start, 'Native DSH must publish its authenticated launch URL')
        const page = await fetch(start, { redirect: 'manual' })
        const cookie = page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
        assert.ok(cookie, 'Use the native browser-session exchange')
        const base = new URL(start).origin
        const call = async (path, body) => {
          const response = await fetch(base + '/ipollo-enterprise/api' + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Cookie: cookie, Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          const data = await response.json()
          assert.equal(response.status, 200, JSON.stringify(data))
          return data
        }
        const unauthenticated = await fetch(base + '/ipollo-enterprise/api/state')
        assert.ok([401, 403].includes(unauthenticated.status))
        const native = await call('/join', input)
        assert.equal(native.connection.memberId, invitation.id)
        const catalog = await call('/state')
        assert.ok(catalog.connections.some(item => item.id === native.connection.id))
        assert.ok(!JSON.stringify(catalog).includes(password))
        assert.ok(!JSON.stringify(catalog).includes('fixture-account-bearer-token'))
        assert.ok(!JSON.stringify(catalog).includes(stored.payload.connections[0].token))
        const workspace = await call('/workspace', { id: native.connection.id })
        assert.equal(typeof workspace.workspaceId, 'string')
        assert.ok((await call('/members?id=' + native.connection.id)).items.some(item => item.id === invitation.id))
        await call('/disconnect', { id: native.connection.id })
        assert.ok(!(await call('/state')).connections.some(item => item.id === native.connection.id))
      })
      await management('member', { status: 'active', role: 'member', departmentId: department.id }, invitation.id)
      assert.equal((await reloaded.refresh(connection.id)).role, 'member')
      await management('member', { status: 'suspended', role: 'member', departmentId: department.id }, invitation.id)
      await assert.rejects(reloaded.refresh(connection.id), { code: 'enterprise_member_inactive' })
      await assert.rejects(reloaded.directory(connection.id, 'members'), { code: 'enterprise_member_inactive' })
      await reloaded.disconnect(connection.id)
      assert.deepEqual(await reloaded.list(), [])
      assert.ok(accountRequests >= 3)
    }
  })
