/** Host-only optional service API. References contain no vendor credentials. */
export interface OfficialService {
  models: {
    id: string
    name: string
    contextWindow: number
    maxTokens: number
  }[]
  id: string
  title: string
  provider: string
  capabilities: string[]
  origin: string
  basePath: string
  routes: { method: string; path: string; points: number }[]
  available: boolean
}
export interface ServiceCatalog {
  items: OfficialService[]
  points: number
}
export type ServiceChoice =
  { source: 'own' } | { source: 'official'; serviceId: string }
export interface ServiceBinding {
  official(provider: string, hasOwnKey?: boolean): Promise<boolean>
  request(provider: string, path: string, init?: RequestInit): Promise<Response>
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
}
export interface ServiceCenter {
  bind(signal?: AbortSignal): Promise<ServiceBinding>
}
