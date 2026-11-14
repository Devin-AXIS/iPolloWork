import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountService } from '../src/host/account.ts'
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
const success: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname
  if (path.endsWith('/sign-in/email')) return json({ token: 'private-session-token', user })
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-session-token')
  if (path.endsWith('/get-session')) return json({ user, session: { token: 'never-return-this' } })
  return json({ points: { balance: 42 } })
}
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
test('remote HTTP account services are rejected before mounting', () => {
  assert.throws(() => resolveConfig({ accountOrigin: 'http://account.example.com' }), { code: 'IPW_INVALID_ACCOUNT_ORIGIN' })
  assert.doesNotThrow(() => resolveConfig({ accountOrigin: 'http://127.0.0.1:3100' }))
})
