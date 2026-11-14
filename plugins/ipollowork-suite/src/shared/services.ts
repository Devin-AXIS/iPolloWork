/** Host-only optional service API. References contain no vendor credentials. */
export type ServiceCategory = 'language' | 'image' | 'video' | 'audio' | 'embedding' | 'tool';
export interface OfficialService {
  category?: ServiceCategory | undefined;
  vendor?: string | undefined;
  models: {
    id: string;
    name: string;
    category?: ServiceCategory | undefined;
    contextWindow?: number | undefined;
    maxTokens?: number | undefined;
  }[];
  id: string;
  title: string;
  provider: string;
  capabilities: string[];
  origin: string;
  basePath: string;
  routes: { method: string; path: string; points: number }[];
  available: boolean;
  /** The owning enterprise for an enterprise model, which bills the enterprise's own provider account; null for official services. */
  enterprise: { id: string; name: string } | null;
}
export interface ServiceCatalog {
  items: OfficialService[];
  points: number;
}
export type ServiceChoice =
  | { source: "own" }
  | { source: "official"; serviceId: string };
export interface ServiceBinding {
  official(provider: string, hasOwnKey?: boolean): Promise<boolean>;
  request(
    provider: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
export interface ServiceCenter {
  bind(signal?: AbortSignal): Promise<ServiceBinding>;
}
