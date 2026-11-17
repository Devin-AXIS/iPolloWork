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

test('only the membership read is retried after a pooled connection resets', async () => {
  let calls = 0
  const connector = new EnterpriseConnector(credentialStore(), async () => {
    if (++calls !== 2) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    return Response.json({ membership: { id: 'member' } })
  })
  assert.deepEqual(await connector.readMembership({ origin: 'https://company.example', token: 'fixture-token' }), { membership: { id: 'member' } })
  await assert.rejects(connector.send('https://company.example', '/api/v1/extension-submissions', { method: 'POST' }), { code: 'connection_failed' })
  assert.equal(calls, 3)
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
          iss: accountOrigin, aud: 'ipollo-enterprise', sub: 'fixture-dsh-user', email, email_verified: true, name: 'DSH Member',
          exp: Math.floor(Date.now() / 1000) + 300,
        })
        return send({ token: content + '.' + sign(null, Buffer.from(content), privateKey).toString('base64url') })
      }
      send({ error: 'unauthorized' }, 401)
    })
    const accountOrigin = await listen(accountServer)
    const companyServer = createServer(async (request, response) => {
      try {
        if (request.url === '/web/manifest') {
          assert.equal(request.headers.authorization, undefined, 'console discovery has no enterprise token')
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ kind: 'enterprise' }))
          return
        }
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
      const members = await (await runtime.request(space, 'view=members')).json()
      const personalCode = members.items.find(member => member.id === invitation.id)?.invitation?.code
      const code = personalCode ?? overview.join?.code
      assert.equal(typeof code, 'string', 'the OS issues a personal code, or a legacy shared code')
      const store = credentialStore()
      const connector = new EnterpriseConnector(store)
      const input = { origin, accountOrigin, email, password, joinCode: code }
      await assert.rejects(connector.join({ ...input, joinCode: 'AAAAA-22222' }), { code: 'JOIN_CODE_NOT_FOUND' })
      assert.deepEqual(await connector.list(), [])
      await assert.rejects(connector.join({ ...input, password: 'wrong-password' }), { code: 'INVALID_EMAIL_OR_PASSWORD' })
      const connection = await connector.join(input)
      assert.equal(connection.memberId, invitation.id)
      assert.equal(connection.role, 'admin')
      assert.equal(connection.name, space.name)
      assert.equal(connection.origin, origin)
      assert.deepEqual(await connector.managementConsole(connection.id), { url: origin + '/' })
      const stored = await store.readRecord(RECORD_KEY)
      assert.ok(stored.payload.connections[0].token.length > 32)
      assert.ok(!JSON.stringify(stored).includes(password))
      assert.ok(!JSON.stringify(stored).includes('fixture-account-bearer-token'))
      assert.ok(!JSON.stringify(connection).includes(stored.payload.connections[0].token))
      const reloaded = new EnterpriseConnector(store)
      assert.equal((await reloaded.refresh(connection.id)).memberId, invitation.id)
      const soon = new Date(Date.now() + 60_000).toISOString()
      stored.payload.connections[0].expiresAt = soon
      assert.ok(Date.parse((await reloaded.inspect(connection.id, true)).expiresAt) > Date.parse(soon))
      assert.ok((await reloaded.directory(connection.id, 'members')).items.some(member => member.id === invitation.id))
      assert.ok((await reloaded.directory(connection.id, 'departments')).items.some(item => item.id === department.id))
      const manifest = await reloaded.memberRequest(connection.id, '/client-manifest')
      assert.equal(manifest.enterprise.id, connection.enterpriseId)
      const mcp = await reloaded.memberRequest(connection.id, '/resources', {
        method: 'POST', body: { name: 'Enterprise test MCP', url: 'https://mcp.example.test/team', requiresOAuth: true },
      })
      const catalog = await reloaded.memberRequest(connection.id, '/resources?type=mcp&view=catalog')
      assert.ok(catalog.items.some(item => item.id === mcp.id))
      const detail = await reloaded.memberRequest(connection.id, '/resources/' + mcp.id)
      assert.equal(detail.mcpRequiresOAuth, true)
      const shortcuts = await reloaded.memberRequest(connection.id, '/navigation-shortcuts')
      assert.ok(Array.isArray(shortcuts.items))
      assert.equal((await reloaded.memberRequest(connection.id, '/messages')).nextCursor, null)
      const access = await reloaded.memberRequest(connection.id, '/resources/' + mcp.id + '/access')
      const saved = await reloaded.memberRequest(connection.id, '/resources/' + mcp.id + '/access', { method: 'PUT', body: {
        revision: access.revision, access: 'restricted', memberIds: [invitation.id],
        departments: [{ id: department.id, includeDescendants: true }],
      } })
      assert.equal(saved.revision, access.revision + 1)
      assert.equal(saved.departments[0].includeDescendants, true)
      const share = await reloaded.memberRequest(connection.id, '/session-shares', { body: {
        idempotencyKey: randomUUID(), title: 'Share verification', markdown: 'Fixture transcript',
        sourceSessionId: randomUUID(), recipientIds: [invitation.id],
      } })
      const message = (await reloaded.memberRequest(connection.id, '/messages')).items.find(item => item.title === 'Share verification')
      assert.equal((await reloaded.memberRequest(connection.id, '/messages/' + message.id)).markdown, 'Fixture transcript')
      await reloaded.memberRequest(connection.id, '/session-shares/' + share.id + '/revoke', { method: 'POST' })
      assert.equal((await reloaded.memberRequest(connection.id, '/messages/' + message.id)).markdown, null)
      if (process.env.DSH_NATIVE_PROOF_HOME) await t.test('native DSH loads the plugin, keeps credentials on the Host, and creates an original workspace', async () => {
        const log = await readFile(join(process.env.DSH_NATIVE_PROOF_HOME, 'server.log'), 'utf8')
        const start = log.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_%.-]+/)?.[0]
        assert.ok(start, 'Native DSH must publish its authenticated launch URL')
        const page = await fetch(start, { redirect: 'manual' })
        const cookie = page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
        assert.ok(cookie, 'Use the native browser-session exchange')
        const base = new URL(start).origin
        const suitePrefix = '/ipollowork-suite/enterprise/os'
        const suite = (await fetch(base + suitePrefix, { headers: { Cookie: cookie } })).ok
        const prefix = suite ? suitePrefix : '/ipollo-enterprise/api'
        const call = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
          const response = await fetch(base + prefix + path, {
            method,
            headers: { Cookie: cookie, Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          const data = await response.json()
          assert.equal(response.status, 200, JSON.stringify(data))
          return data
        }
        const unauthenticated = await fetch(base + prefix + (suite ? '' : '/state'))
        assert.ok([401, 403].includes(unauthenticated.status))
        // A shared QA home can contain offline endpoints left by an interrupted test from another profile.
        const old = await call(suite ? '' : '/state')
        for (const saved of old.connections.filter(item => item.name === space.name && /^http:\/\/127\.0\.0\.1:\d+$/.test(item.origin))) {
          if (suite) await call('/' + saved.id, undefined, 'DELETE')
          else await call('/disconnect', { id: saved.id })
        }
        const joinedNative = await call('/join', input)
        const native = suite ? joinedNative : joinedNative.connection
        assert.equal(native.memberId, invitation.id)
        const catalog = await call(suite ? '' : '/state')
        assert.ok(catalog.connections.some(item => item.id === native.id))
        assert.ok(!JSON.stringify(catalog).includes(password))
        assert.ok(!JSON.stringify(catalog).includes('fixture-account-bearer-token'))
        assert.ok(!JSON.stringify(catalog).includes(stored.payload.connections[0].token))
        const workspace = await call(suite ? '/' + native.id + '/workspace' : '/workspace', suite ? {} : { id: native.id })
        assert.equal(typeof workspace.workspaceId, 'string')
        assert.ok((await call(suite ? '/' + native.id + '/members' : '/members?id=' + native.id)).items.some(item => item.id === invitation.id))
        if (suite) {
          assert.ok((await call('/' + native.id + '/resources?type=mcp&view=catalog')).items.some(item => item.id === mcp.id))
          const denied = await fetch(base + prefix + '/' + native.id + '/os/administrator/session', { headers: { Cookie: cookie } })
          assert.equal(denied.status, 404)
        }
        if (suite && process.env.IPW_ENTERPRISE_BROWSER_PROOF) {
          const { verifyEnterpriseUi } = await import(process.env.IPW_ENTERPRISE_BROWSER_PROOF)
          await call('/' + native.id, undefined, 'DELETE')
          await verifyEnterpriseUi(start, input)
        }
        if (suite) await call('/' + native.id, undefined, 'DELETE')
        else await call('/disconnect', { id: native.id })
        assert.ok(!(await call(suite ? '' : '/state')).connections.some(item => item.id === native.id))
      })
      await management('member', { status: 'active', role: 'member', departmentId: department.id }, invitation.id)
      const moved = await reloaded.refresh(connection.id)
      assert.equal(moved.role, 'member')
      assert.equal(moved.departmentName, 'Engineering')
      assert.deepEqual(await reloaded.managementConsole(connection.id), { url: null })
      await assert.rejects(reloaded.memberRequest(connection.id, '/resources', {
        method: 'POST', body: { name: 'Unauthorized MCP', url: 'https://mcp.example.test/forbidden' },
      }), { status: 403 })
      await management('member', { status: 'suspended', role: 'member', departmentId: department.id }, invitation.id)
      await assert.rejects(reloaded.refresh(connection.id), { code: 'enterprise_member_inactive' })
      await assert.rejects(reloaded.directory(connection.id, 'members'), { code: 'enterprise_member_inactive' })
      await reloaded.disconnect(connection.id)
      assert.deepEqual(await reloaded.list(), [])
      assert.ok(accountRequests >= 3)
    }
  })
