/** Same-origin, owner-authenticated transport; secret fields never enter browser persistence. */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/ipollowork-suite${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } })
  const value = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(value.error ?? 'IPW_SERVICE_UNAVAILABLE')
  return value
}
