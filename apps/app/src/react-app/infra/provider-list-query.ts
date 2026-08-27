import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import {
  OPENCODE_ZEN_PUBLIC_DEFAULT_MODEL_ID,
  openCodeZenPublicModels,
} from "@ipollowork/types/opencode-zen-public-models";
import {
  DEEPSEEK_OFFICIAL_PROVIDER_ID,
  deepSeekOfficialModels,
} from "@ipollowork/types/deepseek-official-models";

import type {
  ModelRef,
  ProviderListItem,
  ProviderListResponse,
  ProviderModel,
} from "../../app/types";
import { dispatchNewProviders } from "../../app/lib/provider-events";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  modelRuntimeAdapters,
  type ModelRuntimeResolution,
} from "../domains/connections/provider-auth/provider-engine-adapter";
import type { SelectableChatModelSnapshot } from "./preferred-chat-model";

export const PROVIDER_LIST_STALE_MS = 5 * 60 * 1000;
export const PROVIDER_LIST_CACHE_MS = 30 * 60 * 1000;
const PROVIDER_LIST_QUERY_ROOT = ["provider-list"] as const;

export type ProviderListQueryInput = {
  client: unknown;
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
};

export type ConnectedProviderSnapshot = Array<{
  id: string;
  name: string;
  source: ProviderListItem["source"];
  models: Record<string, ProviderListItem["models"][string]>;
}>;

export type ConnectedProviderSnapshotChange = {
  changed: boolean;
  previous: ConnectedProviderSnapshot | null;
  next: ConnectedProviderSnapshot;
};

const connectedProviderSnapshots = new Map<string, ConnectedProviderSnapshot>();
const connectedProviderSnapshotChanges = new Map<string, ConnectedProviderSnapshotChange>();
const MAX_CONNECTED_PROVIDER_SNAPSHOTS = 100;

function positiveContextWindow(model: ProviderModel | null | undefined): number | null {
  const value = model?.contextWindow ?? model?.limit?.context;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/** Keep the first catalog's display metadata while filling missing capacity metadata. */
function supplementProviderModel(
  current: ProviderModel,
  candidate: ProviderModel,
): ProviderModel {
  const contextWindow = positiveContextWindow(current) ?? positiveContextWindow(candidate);
  const currentMaxTokens = current.maxTokens ?? current.limit?.output;
  const candidateMaxTokens = candidate.maxTokens ?? candidate.limit?.output;
  const maxTokens = typeof currentMaxTokens === "number" && currentMaxTokens > 0
    ? currentMaxTokens
    : typeof candidateMaxTokens === "number" && candidateMaxTokens > 0
      ? candidateMaxTokens
      : null;
  return {
    ...candidate,
    ...current,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  };
}

function trimConnectedProviderSnapshots(): void {
  while (connectedProviderSnapshots.size > MAX_CONNECTED_PROVIDER_SNAPSHOTS) {
    const oldest = connectedProviderSnapshots.keys().next().value;
    if (oldest === undefined) break;
    connectedProviderSnapshots.delete(oldest);
    connectedProviderSnapshotChanges.delete(oldest);
  }
}

export function providerListQueryKey(input: {
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
}) {
  return [
    ...PROVIDER_LIST_QUERY_ROOT,
    input.engineId?.trim() || DEFAULT_ENGINE_ID,
    input.baseUrl?.trim() ?? "",
    input.directory?.trim() ?? "",
  ] as const;
}

export async function refreshProviderListQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: PROVIDER_LIST_QUERY_ROOT,
    refetchType: "active",
  });
}

export async function fetchProviderList(input: {
  client: unknown;
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
}): Promise<ProviderListResponse> {
  const value = projectKnownProviderModels(
    await modelRuntimeAdapters
      .get(input.engineId)
      .connect(input.client)
      .listProviders(input.directory?.trim() || undefined),
  );
  recordConnectedProviderSnapshot(input, value);
  return value;
}

export function projectKnownProviderModels(
  value: ProviderListResponse,
): ProviderListResponse {
  let changed = false;
  let foundOpenCode = false;
  const all = value.all.map((provider) => {
    if (provider.id === DEEPSEEK_OFFICIAL_PROVIDER_ID) {
      changed = true;
      const models = { ...provider.models };
      for (const profile of deepSeekOfficialModels()) {
        const fallback: ProviderModel = {
          ...profile,
          capabilities: {
            attachment: false,
            reasoning: false,
            input: { text: true, image: false },
            output: { text: true },
          },
        };
        models[profile.id] = models[profile.id]
          ? supplementProviderModel(models[profile.id], fallback)
          : fallback;
      }
      return { ...provider, models };
    }
    if (provider.id !== "opencode") return provider;
    changed = true;
    foundOpenCode = true;
    const models = Object.fromEntries(openCodeZenPublicModels().map((profile) => {
      const discovered = provider.models[profile.id];
      const fallback: ProviderModel = {
        ...profile,
        capabilities: {
          attachment: false,
          reasoning: false,
          toolcall: true,
          input: { text: true, image: false },
          output: { text: true },
        },
      };
      return [profile.id, discovered
        ? supplementProviderModel({ ...discovered, name: profile.name }, fallback)
        : fallback];
    }));
    return { ...provider, models };
  });
  return changed
    ? {
        ...value,
        all,
        default: foundOpenCode
          ? {
              ...value.default,
              opencode: OPENCODE_ZEN_PUBLIC_DEFAULT_MODEL_ID,
            }
          : value.default,
      }
    : value;
}

/**
 * Combine engine catalogs into the app-wide model directory. The first
 * catalog owns display metadata for duplicate entries; later catalogs only
 * add models and providers that are absent there. Engine-specific
 * availability is evaluated separately against the active engine response.
 */
export function mergeProviderListResponses(
  values: ReadonlyArray<ProviderListResponse | null | undefined>,
): ProviderListResponse {
  const providers = new Map<string, ProviderListItem>();
  const connected = new Set<string>();
  const defaults: Record<string, string> = {};

  for (const value of values) {
    if (!value) continue;
    const valueConnected = new Set(value.connected);
    for (const [providerId, modelId] of Object.entries(value.default)) {
      defaults[providerId] ??= modelId;
    }
    for (const provider of value.all) {
      const explicitlyConnected = valueConnected.has(provider.id)
        && (provider.id.trim().toLowerCase() === "opencode" || provider.source !== "env");
      if (explicitlyConnected) connected.add(provider.id);
      const current = providers.get(provider.id);
      if (!current) {
        providers.set(provider.id, {
          ...provider,
          env: [...provider.env],
          models: { ...provider.models },
        });
        continue;
      }
      providers.set(provider.id, {
        ...current,
        source: current.source === "env" && explicitlyConnected
          ? provider.source
          : current.source,
        env: [...new Set([...current.env, ...provider.env])],
        models: Object.fromEntries(
          [...new Set([...Object.keys(current.models), ...Object.keys(provider.models)])]
            .map((modelId) => {
              const currentModel = current.models[modelId];
              const candidateModel = provider.models[modelId];
              return [
                modelId,
                currentModel && candidateModel
                  ? supplementProviderModel(currentModel, candidateModel)
                  : currentModel ?? candidateModel,
              ];
            }),
        ),
      });
    }
  }

  return { all: [...providers.values()], connected: [...connected], default: defaults };
}

/**
 * Project the account credential directory onto an engine catalog. OpenCode
 * reports some API-key providers as `env` even when the key was explicitly
 * saved through iPolloWork. Account credential IDs are authoritative for that
 * distinction, so promote only those providers and keep unrelated ambient
 * shell variables hidden.
 */
export function projectAccountProviderConnections(
  value: ProviderListResponse | null | undefined,
  configuredProviderIds: readonly string[],
): ProviderListResponse | undefined {
  if (!value) return undefined;
  const configured = new Set(configuredProviderIds.map((id) => id.trim()).filter(Boolean));

  let changed = false;
  const all = value.all.map((provider) => {
    if (!configured.has(provider.id) || provider.source !== "env") return provider;
    changed = true;
    return { ...provider, source: "config" as const };
  });
  const available = new Set(all.map((provider) => provider.id));
  // Engine catalogs can report ambient environment credentials as connected.
  // Account configuration is authoritative for user-selectable providers;
  // only the built-in OpenCode route remains connected without a credential.
  const connected = new Set(
    value.connected.filter((providerId) => providerId.trim().toLowerCase() === "opencode"),
  );
  for (const providerId of configured) {
    if (!available.has(providerId)) continue;
    connected.add(providerId);
  }
  const nextConnected = [...connected];
  if (
    nextConnected.length !== value.connected.length
    || nextConnected.some((providerId, index) => providerId !== value.connected[index])
  ) {
    changed = true;
  }
  return changed ? { ...value, all, connected: nextConnected } : value;
}

export async function ensureMergedProviderListQuery(
  queryClient: QueryClient,
  sources: readonly ProviderListQueryInput[],
  options?: { force?: boolean },
): Promise<ProviderListResponse> {
  const results = await Promise.allSettled(
    sources.map((source) => ensureProviderListQuery(queryClient, {
      ...source,
      force: options?.force,
    })),
  );
  const values = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (values.length === 0) {
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  return mergeProviderListResponses(values);
}

/**
 * Subscribe to the account-wide model directory projected through every
 * registered engine runtime. Picker refreshes update these same per-engine
 * query keys, keeping selection and prompt delivery on one readiness view.
 */
export function useMergedProviderListQuery(input: {
  sources: readonly ProviderListQueryInput[];
  enabled?: boolean;
}) {
  const results = useQueries({
    queries: input.sources.map((source) => ({
      queryKey: providerListQueryKey(source),
      enabled: Boolean(source.client) && (input.enabled ?? true),
      staleTime: PROVIDER_LIST_STALE_MS,
      gcTime: PROVIDER_LIST_CACHE_MS,
      queryFn: () => fetchProviderList(source),
    })),
  });
  const values = results.flatMap((result) => result.data ? [result.data] : []);
  return {
    data: values.length ? mergeProviderListResponses(values) : undefined,
    isLoading: values.length === 0 && results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    error: values.length === 0 ? results.find((result) => result.error)?.error ?? null : null,
  };
}

export function getConnectedProviderItems(value: ProviderListResponse | null | undefined) {
  const connected = new Set(value?.connected ?? []);
  return (value?.all ?? []).filter(
    (provider) =>
      connected.has(provider.id) &&
      (provider.source !== "custom" ||
        provider.id === "opencode" ||
        Object.keys(provider.models ?? {}).length > 0),
  );
}

export function getSelectableChatProviderItems(value: ProviderListResponse | null | undefined) {
  return getConnectedProviderItems(value).filter((provider) => {
    // The OpenCode provider is the built-in default chat path. Env-sourced
    // providers can be present because the runtime inherited shell variables,
    // but that does not mean the user intentionally configured them for chat.
    if (provider.id.trim().toLowerCase() === "opencode") return true;
    return provider.source !== "env";
  });
}

/**
 * The account model directory includes disconnected providers so choosing one
 * can start its single shared credential flow. Connection and engine-runtime
 * readiness are evaluated separately by the caller.
 */
export function getChatProviderCatalogItems(value: ProviderListResponse | null | undefined) {
  return (value?.all ?? []).filter((provider) => {
    if (Object.keys(provider.models ?? {}).length === 0) return false;
    if (provider.id.trim().toLowerCase() === "opencode") return true;
    return provider.source !== "env";
  });
}

export type ChatModelCatalogEntry = {
  provider: ProviderListItem;
  modelId: string;
  model: ProviderModel;
};

/**
 * Flatten the connected account catalog without waiting for an engine runtime
 * readiness response. Pickers use this cached snapshot as a non-interactive
 * placeholder while the active runtime refreshes in the background.
 */
export function getChatModelCatalogEntries(
  value: ProviderListResponse | null | undefined,
): ChatModelCatalogEntry[] {
  return getSelectableChatProviderItems(value).flatMap((provider) => (
    Object.entries(provider.models).map(([modelId, model]) => ({ provider, modelId, model }))
  ));
}

export function getModelContextWindow(
  value: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
): number | null {
  if (!model) return null;
  const provider = value?.all.find((entry) => entry.id === model.providerID);
  const selected = provider?.models[model.modelID];
  const exact = positiveContextWindow(selected);
  if (exact) return exact;

  // Engine adapters can namespace the same upstream provider differently
  // (for example `deepseek-official` vs `deepseek`). Reuse an exact model-ID
  // match only when every known catalog entry agrees on its capacity.
  const candidates = new Set(
    (value?.all ?? [])
      .map((entry) => positiveContextWindow(entry.models[model.modelID]))
      .filter((entry): entry is number => entry !== null),
  );
  return candidates.size === 1 ? [...candidates][0] ?? null : null;
}

export function getSelectableChatModelSnapshot(
  value: ProviderListResponse | null | undefined,
): SelectableChatModelSnapshot {
  return getSelectableChatProviderItems(value).map((provider) => ({
    providerID: provider.id,
    modelIDs: Object.keys(provider.models ?? {}),
  }));
}

export type RunnableChatModelEntry = {
  provider: ProviderListItem;
  modelId: string;
  model: ProviderModel;
  runtime: ModelRuntimeResolution;
};

/**
 * Return models that the active engine declares in its provider directory.
 * A directory entry can be ready or temporarily disconnected; callers may
 * render the latter with a reconnect action. Providers and models absent from
 * the active directory remain hidden because that engine did not declare
 * support for them.
 */
export function getEngineChatModelEntries(input: {
  catalog: ProviderListResponse | null | undefined;
  runtime: ProviderListResponse | null | undefined;
  engineId?: string | null;
}): RunnableChatModelEntry[] {
  if (!input.runtime) return [];
  return getChatModelCatalogEntries(input.catalog).flatMap(({ provider, modelId, model }) => {
    const runtime = resolveModelRuntime(
      input.runtime,
      { providerID: provider.id, modelID: modelId },
      input.engineId,
    );
    return runtime.status === "ready" || runtime.status === "provider-disconnected"
      ? [{ provider, modelId, model, runtime }]
      : [];
  });
}

/**
 * Return the account catalog entries that the active agent runtime can
 * execute now. The account catalog owns labels and metadata; the active
 * runtime response is the authority for provider connection and model-route
 * support. Model pickers must consume this intersection instead of rendering
 * unsupported account models as disabled rows.
 */
export function getRunnableChatModelEntries(input: {
  catalog: ProviderListResponse | null | undefined;
  runtime: ProviderListResponse | null | undefined;
  engineId?: string | null;
}): RunnableChatModelEntry[] {
  return getEngineChatModelEntries(input).filter(({ runtime }) => runtime.status === "ready");
}

/**
 * Group the account-owned model directory after intersecting it with the
 * active engine runtime. Runtime-native catalog entries never enter this
 * snapshot, so saved selection and picker options share the same boundary.
 */
export function getRunnableChatModelSnapshot(input: {
  catalog: ProviderListResponse | null | undefined;
  runtime: ProviderListResponse | null | undefined;
  engineId?: string | null;
}): SelectableChatModelSnapshot {
  const modelIdsByProvider = new Map<string, string[]>();
  for (const { provider, modelId } of getRunnableChatModelEntries(input)) {
    const modelIds = modelIdsByProvider.get(provider.id) ?? [];
    modelIds.push(modelId);
    modelIdsByProvider.set(provider.id, modelIds);
  }
  return [...modelIdsByProvider].map(([providerID, modelIDs]) => ({ providerID, modelIDs }));
}

export function getConnectedProviderSnapshot(
  value: ProviderListResponse | null | undefined,
): ConnectedProviderSnapshot {
  return getConnectedProviderItems(value)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      source: provider.source,
      models: Object.fromEntries(
        Object.entries(provider.models ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function isModelAvailableInConnectedProviders(
  value: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
  engineId?: string | null,
) {
  if (!model?.providerID || !model.modelID) return true;
  return resolveModelRuntime(value, model, engineId).status === "ready";
}

export function isModelAvailableInSelectableChatProviders(
  value: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
  engineId?: string | null,
) {
  if (!model?.providerID || !model.modelID) return true;
  const all = getSelectableChatProviderItems(value);
  return resolveModelRuntime(
    value ? { ...value, all, connected: all.map((provider) => provider.id) } : value,
    model,
    engineId,
  ).status === "ready";
}

export function resolveModelRuntime(
  value: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
  engineId?: string | null,
): ModelRuntimeResolution {
  return modelRuntimeAdapters.resolveModel({ engineId, providers: value, model });
}

export function getConnectedProviderSnapshotChange(input: {
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
}) {
  return connectedProviderSnapshotChanges.get(connectedProviderSnapshotKey(input)) ?? null;
}

function recordConnectedProviderSnapshot(
  input: {
    engineId?: string | null;
    baseUrl?: string | null;
    directory?: string | null;
  },
  value: ProviderListResponse,
) {
  const key = connectedProviderSnapshotKey(input);
  const previous = connectedProviderSnapshots.get(key) ?? null;
  const next = getConnectedProviderSnapshot(value);
  const changed = previous !== null && JSON.stringify(previous) !== JSON.stringify(next);
  connectedProviderSnapshots.delete(key);
  connectedProviderSnapshotChanges.delete(key);
  connectedProviderSnapshots.set(key, next);
  connectedProviderSnapshotChanges.set(key, { changed, previous, next });
  trimConnectedProviderSnapshots();
  if (changed) {
    dispatchConnectedProviderChanges(previous, next);
  }
}

function connectedProviderSnapshotKey(input: {
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
}) {
  return JSON.stringify(providerListQueryKey(input));
}

function dispatchConnectedProviderChanges(
  previous: ConnectedProviderSnapshot | null,
  next: ConnectedProviderSnapshot,
) {
  if (!previous) return;
  const previousById = new Map(previous.map((provider) => [provider.id, provider]));
  const newProviders = next.filter((provider) => !previousById.has(provider.id));
  const changedProviders = new Map<string, ConnectedProviderSnapshot[number]>();
  let newModelCount = 0;

  for (const provider of next) {
    const before = previousById.get(provider.id);
    if (!before) {
      newModelCount += Object.keys(provider.models).length;
      changedProviders.set(provider.id, provider);
      continue;
    }
    for (const [id, model] of Object.entries(provider.models)) {
      if (JSON.stringify(before.models[id]) !== JSON.stringify(model)) {
        newModelCount += 1;
        changedProviders.set(provider.id, provider);
      }
    }
  }

  if (newProviders.length === 0 && newModelCount === 0) return;

  dispatchNewProviders({
    providers: [...changedProviders.values()].map((provider) => {
      const firstModelId = Object.keys(provider.models)[0];
      return {
        id: provider.id,
        name: provider.name,
        providerId: provider.id,
        firstModelId,
        firstModelName: firstModelId
          ? (provider.models[firstModelId]?.name ?? firstModelId)
          : undefined,
      };
    }),
    newProviderCount: newProviders.length,
    newModelCount,
    source: "models_refresh",
  });
}

export function ensureProviderListQuery(
  queryClient: QueryClient,
  input: {
    client: unknown;
    engineId?: string | null;
    baseUrl?: string | null;
    directory?: string | null;
    force?: boolean;
  },
) {
  const options = {
    queryKey: providerListQueryKey(input),
    queryFn: () => fetchProviderList(input),
    gcTime: PROVIDER_LIST_CACHE_MS,
  };
  if (input.force) {
    return queryClient.fetchQuery({
      ...options,
      staleTime: 0,
    });
  }
  return queryClient.ensureQueryData({
    ...options,
    staleTime: PROVIDER_LIST_STALE_MS,
    revalidateIfStale: true,
  });
}

export function useProviderListQuery(input: {
  client: unknown | null;
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: providerListQueryKey(input),
    enabled: Boolean(input.client) && (input.enabled ?? true),
    staleTime: PROVIDER_LIST_STALE_MS,
    gcTime: PROVIDER_LIST_CACHE_MS,
    queryFn: () => {
      if (!input.client) {
        return {
          all: [] as ProviderListItem[],
          connected: [],
          default: {},
        } satisfies ProviderListResponse;
      }
      return fetchProviderList({
        client: input.client,
        engineId: input.engineId,
        baseUrl: input.baseUrl,
        directory: input.directory,
      });
    },
  });
}
