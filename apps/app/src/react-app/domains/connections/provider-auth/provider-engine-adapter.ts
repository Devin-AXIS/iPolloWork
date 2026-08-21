import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import type { iPolloWorkServerClient } from "../../../../app/lib/ipollowork-server";
import type { ResolvedWorkspaceEndpoint } from "../../../../app/lib/workspace-endpoint";
import type { DenOrgLlmProviderConnection } from "../../../../app/lib/den";
import type {
  ModelRef,
  ProviderListResponse,
  ProviderModel,
} from "../../../../app/types";
import { codexHarnessProviderEngineAdapter } from "./codex-harness-provider-engine-adapter";
import { deepSeekHarnessProviderEngineAdapter } from "./deepseek-harness-provider-engine-adapter";
import { openCodeProviderEngineAdapter } from "./opencode-provider-engine-adapter";

export { openCodeProviderEngineAdapter } from "./opencode-provider-engine-adapter";
export { deepSeekHarnessProviderEngineAdapter } from "./deepseek-harness-provider-engine-adapter";
export { codexHarnessProviderEngineAdapter } from "./codex-harness-provider-engine-adapter";

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

export type ModelRuntimeConnection = {
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

/** Compatibility name used by provider-management routes. */
export type ProviderEngineConnection = ModelRuntimeConnection;

export type ModelRuntimeCapabilities = {
  text: boolean;
  attachments: boolean;
  vision: boolean;
  reasoning: boolean;
  toolCalls: boolean | null;
};

export type ModelRuntimeResolution = {
  engineId: string;
  model: ModelRef | null;
  status: "ready" | "unselected" | "provider-unavailable" | "provider-disconnected" | "model-unavailable";
  capabilities: ModelRuntimeCapabilities | null;
};

function modelRuntimeCapabilities(model: ProviderModel): ModelRuntimeCapabilities {
  return {
    text: model.capabilities.input?.text !== false && model.capabilities.output?.text !== false,
    attachments: model.capabilities.attachment === true,
    vision: model.capabilities.input?.image === true,
    reasoning: model.capabilities.reasoning === true,
    toolCalls: model.capabilities.toolcall ?? null,
  };
}

/**
 * Engine-facing model boundary. Agent loops and tool orchestration remain in
 * ConversationEngineAdapter; this adapter only exposes and configures the
 * models that an engine can use for inference.
 */
export interface ModelRuntimeAdapter {
  readonly id: string;
  readonly configFileName: string;
  readonly capabilities: {
    cloudProviderImports: boolean;
    customProviders: boolean;
    disabledProviders: boolean;
    authChangesRequireReload: boolean;
  };
  createClient(target: ProviderEngineClientTarget): unknown;
  connect(client: unknown): ModelRuntimeConnection;
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

export class ModelRuntimeAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, ModelRuntimeAdapter>;

  constructor(adapters: readonly ModelRuntimeAdapter[]) {
    const entries = new Map<string, ModelRuntimeAdapter>();
    for (const adapter of adapters) {
      const id = adapter.id.trim();
      if (!id) throw new Error("Model runtime adapter ID is required");
      if (entries.has(id)) throw new Error(`Duplicate model runtime adapter: ${id}`);
      entries.set(id, adapter);
    }
    this.#adapters = entries;
  }

  get(id?: string | null): ModelRuntimeAdapter {
    const resolved = id?.trim() || DEFAULT_ENGINE_ID;
    const adapter = this.#adapters.get(resolved);
    if (!adapter) {
      throw new Error(`Model runtime is not registered: ${resolved}`);
    }
    return adapter;
  }

  ids(): string[] {
    return [...this.#adapters.keys()];
  }

  resolveModel(input: {
    engineId?: string | null;
    providers: ProviderListResponse | null | undefined;
    model: ModelRef | null | undefined;
  }): ModelRuntimeResolution {
    const engineId = this.get(input.engineId).id;
    if (!input.model) {
      return { engineId, model: null, status: "unselected", capabilities: null };
    }
    const provider = input.providers?.all.find((entry) => entry.id === input.model?.providerID);
    if (!provider) {
      return { engineId, model: input.model, status: "provider-unavailable", capabilities: null };
    }
    const model = provider.models[input.model.modelID];
    if (!model) {
      return { engineId, model: input.model, status: "model-unavailable", capabilities: null };
    }
    if (!input.providers?.connected.includes(provider.id)) {
      return {
        engineId,
        model: input.model,
        status: "provider-disconnected",
        capabilities: modelRuntimeCapabilities(model),
      };
    }
    return {
      engineId,
      model: input.model,
      status: "ready",
      capabilities: modelRuntimeCapabilities(model),
    };
  }

  createClient(
    id: string | null | undefined,
    target: ProviderEngineClientTarget,
  ): unknown | null {
    const resolved = id?.trim() || DEFAULT_ENGINE_ID;
    return this.#adapters.get(resolved)?.createClient(target) ?? null;
  }
}

export const modelRuntimeAdapters = new ModelRuntimeAdapterRegistry([
  openCodeProviderEngineAdapter,
  deepSeekHarnessProviderEngineAdapter,
  codexHarnessProviderEngineAdapter,
]);

/** Remove after the settings/session provider-management routes migrate to the canonical name. */
export const providerEngineAdapters = modelRuntimeAdapters;
