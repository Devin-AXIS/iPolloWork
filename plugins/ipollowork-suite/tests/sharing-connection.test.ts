/** Sharing uses one existing account and cancels unfinished native authorizations. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareSharingConnection, type SharingConnection } from '../src/client/native-sharing.ts'

test('a verified sharing connection needs no new login', async () => {
  await prepareSharingConnection({
    suite: async () => ({ ready: true }),
    native: async () => { throw Error('A verified owner must not sign in again') },
  }, new AbortController().signal)
})

test('the native host retains the PKCE verifier and redeems the account-issued code', async () => {
  const calls: [string, unknown][] = []
  const connection: SharingConnection = {
    suite: async (path, body) => {
      calls.push([path, body])
      return path.endsWith('/configure') ? { ready: false } : { code: 'single-use-code' }
    },
    native: async (path, body) => {
      calls.push([path, body])
      return path === 'ownerLoginStart' ? { state: 'transaction', authorizeUrl: 'https://work.test/__liveshare/owner-authorize' } : { state: 'verified' }
    },
  }
  await prepareSharingConnection(connection, new AbortController().signal)
  assert.deepEqual(calls.map(([path]) => path), ['/enterprise/native-sharing/configure', 'ownerLoginStart', '/enterprise/native-sharing/authorize', 'ownerLoginRedeem'])
  assert.deepEqual(calls[3]?.[1], { state: 'transaction', code: 'single-use-code' })
})

test('failed or cancelled account authorization discards the pending native transaction', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController()
    const calls: string[] = []
    await assert.rejects(prepareSharingConnection({
      suite: async path => {
        calls.push(path)
        if (path.endsWith('/configure')) return { ready: false }
        if (cancel) { controller.abort(); return { code: 'code' } }
        throw Error('Account changed')
      },
      native: async path => {
        calls.push(path)
        return { state: 'transaction', authorizeUrl: 'https://work.test/__liveshare/owner-authorize' }
      },
    }, controller.signal))
    assert.equal(calls.at(-1), 'ownerLoginCancel')
    assert(!calls.includes('ownerLoginRedeem'))
  }
})
