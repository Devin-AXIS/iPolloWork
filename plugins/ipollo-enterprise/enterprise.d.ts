export const DEFAULT_ACCOUNT_ORIGIN: string

export class EnterpriseError extends Error {
  readonly code: string
  readonly status: number
}

export interface EnterpriseConnection {
  id: string
  enterpriseId: string
  name: string
  origin: string
  accountOrigin: string
  email: string
  memberId: string
  role: string
  status: string
  departmentId: string | null
  departmentName: string | null
  expiresAt: string
}

export class EnterpriseConnector {
  constructor(credentials: object, fetcher?: typeof fetch, signal?: AbortSignal)
  discover(value: string): Promise<{ id: string; name: string; origin: string }>
  list(): Promise<EnterpriseConnection[]>
  join(input: { origin: string; accountOrigin?: string | undefined; email: string; password: string; joinCode: string; allowInsecureAccount?: boolean | undefined }): Promise<EnterpriseConnection>
  inspect(id: string, renew?: boolean): Promise<EnterpriseConnection>
  refresh(id: string): Promise<EnterpriseConnection>
  renewDueConnections(): Promise<void>
  webShortcuts(id: string): Promise<{ items: Array<{ id: string; label: string }> }>
  webShortcuts(id: string, shortcut: string): Promise<{ url: string }>
  disconnect(id: string): Promise<void>
  managementConsole(id: string): Promise<{ url: string | null }>
  memberRequest(id: string, path: string, options?: {
    method?: string; body?: unknown; form?: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>;
    headers?: Record<string, string>; signal?: AbortSignal;
  }, binary?: boolean): Promise<unknown>
}
