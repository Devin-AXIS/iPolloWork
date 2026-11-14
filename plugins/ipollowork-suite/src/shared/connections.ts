/** Optional client protocol for plugin-owned service credentials. No secret is retained by the registry. */
export type ConnectionText = { en: string; zh: string }
export interface ConnectionField {
  id: string
  label: ConnectionText
  secret: boolean
  required?: boolean
}
export interface ConnectionStatus {
  configured: boolean
  writable: boolean
  fields?: Record<string, boolean>
}
export interface ConnectionProvider {
  id: string
  title: ConnectionText
  plugins: readonly string[]
  fields: readonly ConnectionField[]
  load(signal: AbortSignal): Promise<ConnectionStatus>
  save(values: Record<string, string>, signal: AbortSignal): Promise<ConnectionStatus>
}
export interface ConnectionManager {
  /** Register a provider until its plugin unloads. Equal ids share one displayed entry. */
  register(provider: ConnectionProvider): () => void
  /** Open the common connection editor, optionally at one service. */
  open(id?: string): void
}
