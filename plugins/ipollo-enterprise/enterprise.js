import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

export const RECORD_KEY = 'ipollo-enterprise-connector/connections'
export const DEFAULT_ACCOUNT_ORIGIN = 'https://i.ipollo.ai'

/** A bounded, user-facing protocol failure. Never contains a credential. */
export class EnterpriseError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

function required(value, maximum = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new EnterpriseError('invalid_input')
  return value.trim()
}

/** Accept a company URL, including an explicitly configured reverse-proxy prefix. */
export function enterpriseOrigin(value, allowPublicHttp = false) {
  let url
  try { url = new URL(required(value, 2048)) } catch { throw new EnterpriseError('invalid_enterprise_url') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || ['0.0.0.0', '[::]'].includes(url.hostname)) throw new EnterpriseError('invalid_enterprise_url')
  const ipv4 = isIP(url.hostname) === 4 ? url.hostname.split('.').map(Number) : null
  const privateHost = url.hostname === 'localhost' || ipv4 && (ipv4[0] === 127 || ipv4[0] === 10
    || ipv4[0] === 192 && ipv4[1] === 168 || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || url.hostname === '[::1]' || url.hostname.endsWith('.local')
  if (url.protocol === 'http:' && !privateHost && !allowPublicHttp) throw new EnterpriseError('https_required')
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function joinCode(value) {
  const code = required(value, 40).toUpperCase().replace(/[\s-]/g, '')
  if (!/^[A-Z2-9]{10}$/.test(code)) throw new EnterpriseError('invalid_join_code')
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

async function responseJson(response) {
  if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new EnterpriseError('invalid_response', 502)
  const reader = response.body?.getReader()
  if (!reader) throw new EnterpriseError('invalid_response', 502)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new EnterpriseError('invalid_response', 502) }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error instanceof EnterpriseError) throw error
    throw new EnterpriseError('invalid_response', 502)
  } finally { reader.releaseLock() }
}

const publicErrors = new Set(['JOIN_CODE_NOT_FOUND', 'MEMBER_SUSPENDED', 'MEMBER_IDENTITY_CONFLICT',
  'invalid_identity_token', 'unauthorized', 'forbidden', 'enterprise_member_inactive', 'enterprise_session_secret_required',
  'INVALID_EMAIL_OR_PASSWORD', 'INVALID_EMAIL_PASSWORD', 'invalid_credentials'])

/** HTTP adapter for the existing OS/Enterprise and iPollo Account contracts. */
export class EnterpriseConnector {
  constructor(credentials, fetcher = fetch, signal) {
    this.credentials = credentials
    this.fetcher = fetcher
    this.signal = signal
  }

  async send(origin, path, { token, body, signal } = {}) {
    const signals = [AbortSignal.timeout(20000), this.signal, signal].filter(Boolean)
    const headers = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let response
    try {
      response = await this.fetcher(origin + path, {
        method: body === undefined ? 'GET' : 'POST', headers, redirect: 'error',
        signal: AbortSignal.any(signals), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new EnterpriseError('connection_failed', 502) }
    const data = await responseJson(response)
    if (!response.ok) {
      const code = publicErrors.has(data?.error) ? data.error : response.status === 401 ? 'unauthorized'
        : response.status === 403 ? 'forbidden' : 'enterprise_unavailable'
      throw new EnterpriseError(code, response.status)
    }
    return data
  }

  async discover(value) {
    const origin = enterpriseOrigin(value)
    const data = await this.send(origin, '/.well-known/ipollo-enterprise')
    if (!/^ent_[A-Za-z0-9_-]{1,124}$/.test(data?.serverId) || typeof data.name !== 'string'
      || !data.name.trim() || data.name.length > 160 || data.authMode !== 'ipollo_oidc') throw new EnterpriseError('incompatible_enterprise')
    return { id: data.serverId, name: data.name, origin }
  }

  async stored() {
    const record = await this.credentials.readRecord(RECORD_KEY)
    if (record === undefined) return []
    if (record.kind !== 'grant' || record.payload?.version !== 1 || !Array.isArray(record.payload.connections)) {
      throw new EnterpriseError('invalid_saved_connections', 500)
    }
    return record.payload.connections
  }

  /** Return connection metadata only; stored tokens never cross the Host boundary. */
  present(row) {
    return { id: row.id, enterpriseId: row.enterpriseId, name: row.name, origin: row.origin,
      accountOrigin: row.accountOrigin, email: row.email, memberId: row.memberId,
      role: row.role, status: row.status, departmentId: row.departmentId ?? null, expiresAt: row.expiresAt }
  }

  async list() { return (await this.stored()).map(row => this.present(row)) }

  async update(id, mutation) {
    this.signal?.throwIfAborted()
    return this.credentials.modifyRecord(RECORD_KEY, async record => {
      this.signal?.throwIfAborted()
      if (record && (record.kind !== 'grant' || record.payload?.version !== 1 || !Array.isArray(record.payload.connections))) {
        throw new EnterpriseError('invalid_saved_connections', 500)
      }
      const rows = record?.payload.connections ?? []
      const next = await mutation(rows.find(row => row.id === id))
      const connections = rows.filter(row => row.id !== id)
      if (next) connections.push(next)
      return { kind: 'grant', payload: { version: 1, connections } }
    })
  }

  async join(input) {
    const origin = enterpriseOrigin(input.origin)
    const accountOrigin = enterpriseOrigin(input.accountOrigin ?? DEFAULT_ACCOUNT_ORIGIN, input.allowInsecureAccount === true)
    const email = required(input.email, 254).toLowerCase()
    const code = joinCode(input.joinCode)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof input.password !== 'string'
      || !input.password || input.password.length > 1024) throw new EnterpriseError('invalid_login')
    const enterprise = await this.discover(origin)
    const login = await this.send(accountOrigin, '/api/auth/sign-in/email', { body: { email, password: input.password } })
    if (typeof login?.token !== 'string' || !login.token) throw new EnterpriseError('account_token_missing', 502)
    const identity = await this.send(accountOrigin, '/api/auth/token', { token: login.token })
    if (typeof identity?.token !== 'string' || !identity.token) throw new EnterpriseError('identity_token_missing', 502)
    const joined = await this.send(origin, '/api/v1/join', { body: { joinCode: code, identityToken: identity.token } })
    if (joined?.enterprise?.id !== enterprise.id || !/^[A-Za-z0-9_-]{1,128}$/.test(joined?.membership?.id ?? '')
      || joined.membership.status !== 'active' || typeof joined?.session?.token !== 'string'
      || !(Date.parse(joined.session.expiresAt) > Date.now())) throw new EnterpriseError('invalid_join_response', 502)
    const token = joined.session.token
    const { membership } = await this.send(origin, '/api/v1/membership', { token })
    if (membership?.id !== joined.membership.id || membership.status !== 'active') throw new EnterpriseError('identity_changed', 403)
    const id = createHash('sha256').update(`${origin}\n${enterprise.id}\n${membership.id}`).digest('hex').slice(0, 24)
    const row = { id, enterpriseId: enterprise.id, name: enterprise.name, origin, accountOrigin, email,
      memberId: membership.id, role: membership.role, status: membership.status,
      departmentId: membership.departmentId ?? null, expiresAt: joined.session.expiresAt, token }
    await this.update(id, () => row)
    return this.present(row)
  }

  async connection(id) {
    const row = (await this.stored()).find(row => row.id === id)
    if (!row) throw new EnterpriseError('connection_not_found', 404)
    if (!(Date.parse(row.expiresAt) > Date.now())) throw new EnterpriseError('enterprise_session_expired', 401)
    return row
  }

  async refresh(id) {
    const row = await this.connection(id)
    const { membership } = await this.send(row.origin, '/api/v1/membership', { token: row.token })
    if (membership?.id !== row.memberId) throw new EnterpriseError('identity_changed', 403)
    if (membership.status !== 'active') throw new EnterpriseError('enterprise_member_inactive', 403)
    const next = { ...row, role: membership.role, status: membership.status, departmentId: membership.departmentId ?? null }
    await this.update(id, current => {
      if (!current || current.token !== row.token) throw new EnterpriseError('identity_changed', 409)
      return next
    })
    return this.present(next)
  }

  async directory(id, kind, cursor) {
    if (!['members', 'departments'].includes(kind)) throw new EnterpriseError('invalid_input')
    await this.refresh(id)
    const row = await this.connection(id)
    const query = new URLSearchParams({ limit: '50' })
    if (cursor) query.set('cursor', required(cursor, 256))
    const page = await this.send(row.origin, `/api/v1/${kind}?${query}`, { token: row.token })
    if (!Array.isArray(page?.items) || page.items.length > 100
      || !(page.nextCursor === null || typeof page.nextCursor === 'string' && page.nextCursor.length <= 256)
      || !page.items.every(item => typeof item?.id === 'string' && item.id.length <= 128
        && (kind === 'members' ? typeof item.email === 'string' && typeof item.role === 'string'
          : typeof item.name === 'string'))) throw new EnterpriseError('invalid_response', 502)
    return page
  }

  async disconnect(id) { await this.update(id, () => undefined) }
}
