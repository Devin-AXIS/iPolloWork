import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountService, publicAccountState } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import type { CredentialStore } from '../src/shared/types.ts'

function credentials() {
  let record: { kind: string; payload?: unknown } | undefined
  const store: CredentialStore = {
    readRecord: async () => record,
    modifyRecord: async (_key, operation) => { record = await operation(record); return record },
    deleteRecord: async () => { record = undefined },
  }
  return { store, record: () => record }
}
const user = { id: 'test-user', name: 'Test member', email: 'test@example.com' }
const config = resolveConfig({ accountOrigin: 'https://account.example.com' })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
test('the default uses the production service and explicit deployments remain authoritative', () => {
  assert.equal(resolveConfig({}).accountOrigin, 'https://cloud.ipollo.net')
  assert.equal(resolveConfig({ accountOrigin: 'https://work.ipollo.net/' }).accountOrigin, 'https://work.ipollo.net')
  assert.equal(resolveConfig({}).automaticOutputArchive, false)
  assert.equal(resolveConfig({ accountOrigin: 'https://accounts.example.com' }).accountOrigin, 'https://accounts.example.com')
})
const success: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  if (path.endsWith('/sign-in/email')) return json({ token: 'private-session-token', user })
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-session-token')
  if (path.endsWith('/get-session')) return json({ user, session: { token: 'never-return-this' } })
  return json({ points: { balance: 42 } })
}
test('business failures retain safe codes even when a gateway returns HTML', async () => {
  const store: CredentialStore = {
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: config.accountOrigin, token: 'private-token' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  }
  for (const [status, code] of [[401, 'IPW_SIGN_IN_REQUIRED'], [403, 'RESOURCE_FORBIDDEN'], [429, 'RATE_LIMITED'], [503, 'IPW_ACCOUNT_UNAVAILABLE']] as const) {
    const account = new AccountService(store, config, new AbortController().signal, async () => new Response('<html>private proxy diagnostic</html>', { status }))
    await assert.rejects(account.request('/api/v1/enterprises'), { code, status })
  }
  const account = new AccountService(store, config, new AbortController().signal, async () => json({ code: 'SERVICE_QUEUE_TIMEOUT', error: 'private diagnostic' }, 503))
  await assert.rejects(account.request('/api/v1/enterprises'), { code: 'SERVICE_QUEUE_TIMEOUT', status: 503 })
})
test('account timeouts are distinct from connection failures', async () => {
  const store: CredentialStore = {
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: config.accountOrigin, token: 'private-token' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  }
  const stalled: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture did not cancel')), 2000)
    init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason) }, { once: true })
  })
  const account = new AccountService(store, resolveConfig({ accountOrigin: config.accountOrigin, requestTimeoutMs: 1000 }), new AbortController().signal, stalled)
  await assert.rejects(account.request('/api/v1/enterprises'), { code: 'IPW_ACCOUNT_TIMEOUT', status: 504 })
})
test('registration uses the configured service and retains only the session grant', async () => {
  const fixture = credentials()
  let submitted: unknown
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/sign-up/email')) {
      submitted = JSON.parse(String(init?.body))
      return json({ token: 'private-session-token', user })
    }
    return success(input, init)
  }
  const account = new AccountService(fixture.store, config, new AbortController().signal, fetcher)
  const result = await account.signUp({ name: ' Test member ', email: user.email, password: 'new-password-123' })
  assert.deepEqual(submitted, { name: 'Test member', email: user.email, password: 'new-password-123' })
  assert.equal(result.status, 'signed-in')
  assert(!JSON.stringify(result).includes('private-session-token'))
  assert(!JSON.stringify(fixture.record()).includes('new-password-123'))
})
test('registration rejects incomplete input and does not store a rejected account', async () => {
  const fixture = credentials()
  let sent = false
  const account = new AccountService(fixture.store, config, new AbortController().signal, async () => {
    sent = true
    return json({ error: 'private-provider-diagnostic' }, 422)
  })
  for (const input of [
    { name: '', email: user.email, password: 'new-password-123' },
    { name: user.name, email: 'invalid', password: 'new-password-123' },
    { name: user.name, email: user.email, password: 'short' },
  ]) await assert.rejects(account.signUp(input), { code: 'IPW_REGISTRATION_REJECTED' })
  assert.equal(sent, false)
  await assert.rejects(account.signUp({ name: user.name, email: user.email, password: 'new-password-123' }), { code: 'IPW_REGISTRATION_REJECTED' })
  assert.equal(fixture.record(), undefined)
})
test('sign-in survives a new service, exposes no credentials, and disconnect removes its record', async () => {
  const fixture = credentials()
  const a = new AccountService(fixture.store, config, new AbortController().signal, success)
  const state = await a.signIn({ email: user.email, password: 'test-password' })
  assert.equal(state.status, 'signed-in')
  assert(!JSON.stringify(state).includes('private-session-token'))
  assert(!('origin' in publicAccountState(state)))
  assert(!JSON.stringify(fixture.record()).includes('test-password'))
  const b = new AccountService(fixture.store, config, new AbortController().signal, success)
  assert.deepEqual(await b.state(), state)
  assert.equal((await b.signOut()).status, 'anonymous')
  assert.equal(fixture.record(), undefined)
})
test('a rejected login never persists credentials or forwards upstream diagnostics', async () => {
  const fixture = credentials()
  const a = new AccountService(fixture.store, config, new AbortController().signal, async () => json({ error: 'secret diagnostic' }, 401))
  await assert.rejects(a.signIn({ email: user.email, password: 'bad' }), { code: 'IPW_SIGN_IN_REQUIRED' })
  assert.equal(fixture.record(), undefined)
})
test('an unavailable balance is not fabricated as zero', async () => {
  const fixture = credentials()
  const fetcher: typeof fetch = (input, init) => String(input).endsWith('/summary') ? Promise.resolve(json({}, 503)) : success(input, init)
  const state = await new AccountService(fixture.store, config, new AbortController().signal, fetcher).signIn({ email: user.email, password: 'valid' })
  assert.equal(state.status, 'signed-in')
  if (state.status === 'signed-in') { assert.equal(state.points, null); assert.equal(state.balanceStatus, 'unavailable') }
})
test('sign-out supersedes a login still waiting on the service', async () => {
  const fixture = credentials(); let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const fetcher: typeof fetch = async (input, init) => { await waiting; return success(input, init) }
  const a = new AccountService(fixture.store, config, new AbortController().signal, fetcher)
  const login = a.signIn({ email: user.email, password: 'valid' })
  await a.signOut(); release()
  await assert.rejects(login, { code: 'IPW_LOGIN_CANCELLED' })
  assert.equal(fixture.record(), undefined)
})
test('changing the configured account origin cannot send an existing token to another server', async () => {
  const fixture = credentials()
  await new AccountService(fixture.store, config, new AbortController().signal, success).signIn({ email: user.email, password: 'valid' })
  const a = new AccountService(fixture.store, resolveConfig({ accountOrigin: 'https://other.example.com' }), new AbortController().signal, async () => { throw new Error('must not send') })
  assert.equal((await a.state()).status, 'anonymous')
})
test('moving to the official cloud service does not send old-origin sign-in grants', async () => {
  const fixture = credentials()
  await fixture.store.modifyRecord('ipollowork-suite/account', async () => ({
    kind: 'grant', payload: { version: 1, origin: 'https://work.ipollo.net', token: 'old-origin-token' },
  }))
  const account = new AccountService(fixture.store, resolveConfig({ accountOrigin: 'https://cloud.ipollo.net' }),
    new AbortController().signal, async () => { assert.fail('old-origin grant was sent') })
  assert.deepEqual(publicAccountState(await account.state()), { status: 'anonymous' })
})
test('remote HTTP account services are rejected before mounting', () => {
  assert.throws(() => resolveConfig({ accountOrigin: 'http://account.example.com' }), { code: 'IPW_INVALID_ACCOUNT_ORIGIN' })
  assert.doesNotThrow(() => resolveConfig({ accountOrigin: 'http://127.0.0.1:3100' }))
})

test('Stage business responses cannot cross an account change and larger documents keep their own bounded budget', async () => {
  const fixture=credentials(),entered=Promise.withResolvers<void>(),reply=Promise.withResolvers<Response>();
  const account=new AccountService(fixture.store,config,new AbortController().signal,async(input,init)=>{
    if(String(input).endsWith('/api/v1/stage/document')){entered.resolve();return reply.promise;}
    return success(input,init);
  });
  await account.signIn({email:user.email,password:'test-password'});
  const pending=account.request('/api/v1/stage/document',{},'POST');await entered.promise;
  await account.signOut();reply.resolve(json({privateDoc:'old account'}));
  await assert.rejects(pending,{code:'IPW_ACCOUNT_CHANGED'});
  const documents=new AccountService(credentials().store,config,new AbortController().signal,async(input,init)=>String(input).endsWith('/api/v1/stage/document')?json({doc:'x'.repeat(2*1024*1024)}):success(input,init));
  await documents.signIn({email:user.email,password:'test-password'});
  await assert.rejects(documents.request('/api/v1/stage/document',{},'POST'),{code:'IPW_RESPONSE_TOO_LARGE'});
  const result=await documents.request('/api/v1/stage/document',{},'POST',undefined,{maximum:3*1024*1024}) as {doc:string};assert.equal(result.doc.length,2*1024*1024);
});
