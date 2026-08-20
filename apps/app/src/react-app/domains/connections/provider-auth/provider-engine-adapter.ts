import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import type { iPolloWorkServerClient } from "../../../../app/lib/ipollowork-server";
import type { ResolvedWorkspaceEndpoint } from "../../../../app/lib/workspace-endpoint";
import type { DenOrgLlmProviderConnection } from "../../../../app/lib/den";
import type { ProviderListResponse } from "../../../../app/types";
import { deepSeekHarnessProviderEngineAdapter } from "./deepseek-harness-provider-engine-adapter";
import { openCodeProviderEngineAdapter } from "./opencode-provider-engine-adapter";

export { openCodeProviderEngineAdapter } from "./opencode-provider-engine-adapter";
export { deepSeekHarnessProviderEngineAdapter } from "./deepseek-harness-provider-engine-adapter";

export type ProviderEngineAuthMethod = {
  type: "oauth" | "api";
  label: string;
};

export type ProviderEngineAuthAuthorization = {
  url: string;
  method: "auto" | "code";
  instructions: string;
};

export type CompatibleProviderProfile = {
  id: string;
  name: string;
  npm?: string;
  api?: string;
  baseURL?: string;
  models: Record<string, Record<string, unknown>>;
};

export type ProviderEngineConfigTarget = {
  ipolloworkClient: iPolloWorkServerClient | null;
  workspaceId: string | null;
  hasiPolloWorkTarget: boolean;
  canUseiPolloWorkServer: boolean;
  isLocalWorkspace: boolean;
  root: string;
};

export type ProviderEngineClientTarget = {
  endpoint: ResolvedWorkspaceEndpoint;
  directory?: string | null;
};

export type ProviderEngineConnection = {
  listProviders(directory?: string): Promise<ProviderListResponse>;
  listAuthMethods(): Promise<Record<string, ProviderEngineAuthMethod[]>>;
  authorizeOAuth(providerId: string, methodIndex: number): Promise<ProviderEngineAuthAuthorization>;
  completeOAuth(providerId: string, methodIndex: number, code?: string): Promise<void>;
  setApiKey(providerId: string, apiKey: string): Promise<void>;
  removeCredentials(providerId: string): Promise<void>;
  readDisabledProviders(): Promise<string[]>;
  writeDisabledProviders(providerIds: string[]): Promise<void>;
  dispose(): Promise<void>;
  waitUntilHealthy(): Promise<void>;
};

export interface ProviderEngineAdapter {
  readonly id: string;
  readonly configFileName: string;
  readonly capabilities: {
    cloudProviderImports: boolean;
    customProviders: boolean;
    disabledProviders: boolean;
    authChangesRequireReload: boolean;
  };
  createClient(target: ProviderEngineClientTarget): unknown;
  connect(client: unknown): ProviderEngineConnection;
  emptyProjectConfig(): string;
  readProjectConfig(target: ProviderEngineConfigTarget): Promise<{ content?: string | null } | null>;
  writeProjectConfig(target: ProviderEngineConfigTarget, content: string): Promise<boolean>;
  patchRuntimeProviders(target: ProviderEngineConfigTarget, update: Record<string, unknown>): Promise<void>;
  runtimeProviderIds(target: ProviderEngineConfigTarget): Promise<string[]>;
  projectProviderIds(raw: string): string[];
  formatProjectProviderDisabledState(raw: string, providerId: string, disabled: boolean): string;
  buildCloudProviderPatch(
    provider: DenOrgLlmProviderConnection,
    localProviderId: string,
    previousProviderId?: string | null,
  ): Record<string, unknown>;
  buildCompatibleProviderPatch(profile: CompatibleProviderProfile): Record<string, unknown>;
}

export class ProviderEngineAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, ProviderEngineAdapter>;

  constructor(adapters: readonly ProviderEngineAdapter[]) {
    const entries = new Map<string, ProviderEngineAdapter>();
    for (const adapter of adapters) {
      const id = adapter.id.trim();
      if (!id) throw new Error("Provider engine adapter ID is required");
      if (entries.has(id)) throw new Error(`Duplicate provider engine adapter: ${id}`);
      entries.set(id, adapter);
    }
    this.#adapters = entries;
  }

  get(id?: string | null): ProviderEngineAdapter {
    const resolved = id?.trim() || DEFAULT_ENGINE_ID;
    const adapter = this.#adapters.get(resolved);
    if (!adapter) {
      throw new Error(`Provider engine is not registered: ${resolved}`);
    }
    return adapter;
  }

  ids(): string[] {
    return [...this.#adapters.keys()];
  }

  createClient(
    id: string | null | undefined,
    target: ProviderEngineClientTarget,
  ): unknown | null {
    const resolved = id?.trim() || DEFAULT_ENGINE_ID;
    return this.#adapters.get(resolved)?.createClient(target) ?? null;
  }
}

export const providerEngineAdapters = new ProviderEngineAdapterRegistry([
  openCodeProviderEngineAdapter,
  deepSeekHarnessProviderEngineAdapter,
]);
