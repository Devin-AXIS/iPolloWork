/** Same-origin, owner-authenticated transport; secret fields never enter browser persistence. */
import { HarnessError } from '@deepseek-ai/dsh-error'

export class RequestError extends HarnessError {
  constructor(code: string, options?: ErrorOptions) { super(code, code, options) }
}
export class RosterRequestError extends RequestError {
  constructor(code: string, readonly row: number) { super(code) }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/ipollowork-suite${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } })
  } catch (cause) {
    if (options.signal?.aborted) throw options.signal.reason
    throw new RequestError('IPW_HOST_UNAVAILABLE', { cause })
  }
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
    const code = typeof record?.error === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(record.error)
      ? record.error : response.status === 401 ? 'IPW_SIGN_IN_REQUIRED'
        : response.status === 403 ? 'RESOURCE_FORBIDDEN'
          : response.status === 429 ? 'RATE_LIMITED' : 'IPW_SERVICE_UNAVAILABLE'
    if (typeof record?.row === 'number' && Number.isSafeInteger(record.row) && record.row > 0)
      throw new RosterRequestError(code, record.row)
    throw new RequestError(code)
  }
  if (value === undefined) throw new RequestError('IPW_INVALID_RESPONSE')
  return value as T
}
