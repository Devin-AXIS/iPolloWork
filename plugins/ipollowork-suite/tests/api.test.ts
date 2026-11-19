import test from 'node:test'
import assert from 'node:assert/strict'
import { request, RosterRequestError } from '../src/client/api.ts'
import { enterpriseError, enterpriseCopy } from '../src/client/enterprise-locale.ts'
import type { ClientContext } from '../src/client/native.ts'

test('client transport preserves safe error codes and roster rows without exposing response diagnostics', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ error: 'SERVICE_QUEUE_TIMEOUT' }, { status: 503 })
    await assert.rejects(request('/enterprise'), { code: 'SERVICE_QUEUE_TIMEOUT' })
    globalThis.fetch = async () => Response.json({ error: 'INVALID_INPUT', row: 4 }, { status: 400 })
    await assert.rejects(request('/enterprise'), error => error instanceof RosterRequestError && error.row === 4)
    globalThis.fetch = async () => Response.json({ error: 'upstream private-token diagnostic' }, { status: 500 })
    await assert.rejects(request('/enterprise'), { code: 'IPW_SERVICE_UNAVAILABLE' })
    for (const [status, code] of [[401, 'IPW_SIGN_IN_REQUIRED'], [403, 'RESOURCE_FORBIDDEN'], [429, 'RATE_LIMITED'], [503, 'IPW_SERVICE_UNAVAILABLE']] as const) {
      globalThis.fetch = async () => new Response('<html>private gateway diagnostic</html>', { status })
      await assert.rejects(request('/enterprise'), { code })
    }
    globalThis.fetch = async () => new Response('invalid json')
    await assert.rejects(request('/enterprise'), { code: 'IPW_INVALID_RESPONSE' })
    globalThis.fetch = async () => { throw new TypeError('private network diagnostic') }
    await assert.rejects(request('/enterprise'), { code: 'IPW_HOST_UNAVAILABLE' })
    const lifetime = new AbortController()
    lifetime.abort(new Error('cancelled'))
    await assert.rejects(request('/enterprise', { signal: lifetime.signal }), lifetime.signal.reason)
  } finally { globalThis.fetch = original }
})

test('organization errors explain common failures and retain only safe diagnostic codes in both languages', () => {
  for (const language of ['zh', 'en']) {
    const t = enterpriseCopy({ locale: { getSnapshot: () => language } } as ClientContext)
    for (const code of ['IPW_ACCOUNT_UNAVAILABLE', 'IPW_ACCOUNT_TIMEOUT', 'IPW_HOST_UNAVAILABLE', 'SERVICE_BUSY', 'SERVICE_QUEUE_TIMEOUT', 'SERVICE_DRAINING', 'DATABASE_UNAVAILABLE', 'IPW_INVALID_RESPONSE', 'INTERNAL_ERROR']) {
      const message = enterpriseError(code, t, t.organizationListLoadFailed)
      assert(message.includes(code))
      assert.notEqual(message, t.operationFailed)
      assert.notEqual(message, t.organizationListLoadFailed + ` (${code})`)
    }
    assert.equal(enterpriseError('FUTURE_SERVICE_ERROR', t), t.operationFailed + ' (FUTURE_SERVICE_ERROR)')
    assert.equal(enterpriseError('private token: abc', t), t.operationFailed)
  }
})
