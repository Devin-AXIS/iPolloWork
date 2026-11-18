/** Same-origin, owner-authenticated transport; secret fields never enter browser persistence. */
export class RosterRequestError extends Error {
  constructor(code: string, readonly row: number) { super(code) }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/ipollowork-suite${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } })
  const value = await response.json() as T & { error?: string; row?: unknown }
  if (!response.ok) {
    const code = value.error ?? 'IPW_SERVICE_UNAVAILABLE'
    if (typeof value.row === 'number' && Number.isSafeInteger(value.row) && value.row > 0)
      throw new RosterRequestError(code, value.row)
    throw new Error(code)
  }
  return value
}
