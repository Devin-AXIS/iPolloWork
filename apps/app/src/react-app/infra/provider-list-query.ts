import { useQuery, type QueryClient } from "@tanstack/react-query";

import type {
  ModelRef,
  ProviderListItem,
  ProviderListResponse,
} from "../../app/types";
import { dispatchNewProviders } from "../../app/lib/provider-events";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import {
  modelRuntimeAdapters,
  type ModelRuntimeResolution,
} from "../domains/connections/provider-auth/provider-engine-adapter";
import type { SelectableChatModelSnapshot } from "./preferred-chat-model";

export const PROVIDER_LIST_CACHE_MS = 5 * 60 * 1000;
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
  await queryClient.invalidateQueries({ queryKey: PROVIDER_LIST_QUERY_ROOT });
  await queryClient.refetchQueries({ queryKey: PROVIDER_LIST_QUERY_ROOT, type: "active" });
}

export async function fetchProviderList(input: {
  client: unknown;
  engineId?: string | null;
  baseUrl?: string | null;
  directory?: string | null;
}): Promise<ProviderListResponse> {
  const value = await modelRuntimeAdapters
    .get(input.engineId)
    .connect(input.client)
    .listProviders(input.directory?.trim() || undefined);
  recordConnectedProviderSnapshot(input, value);
  return value;
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
        models: { ...provider.models, ...current.models },
      });
    }
  }

  return { all: [...providers.values()], connected: [...connected], default: defaults };
}

export async function ensureMergedProviderListQuery(
  queryClient: QueryClient,
  sources: readonly ProviderListQueryInput[],
  options?: { force?: boolean },
): Promise<ProviderListResponse> {
  const values = await Promise.all(
    sources.map((source) => ensureProviderListQuery(queryClient, {
      ...source,
      force: options?.force,
    })),
  );
  return mergeProviderListResponses(values);
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

export function getSelectableChatModelSnapshot(
  value: ProviderListResponse | null | undefined,
): SelectableChatModelSnapshot {
  return getSelectableChatProviderItems(value).map((provider) => ({
    providerID: provider.id,
    modelIDs: Object.keys(provider.models ?? {}),
  }));
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
    staleTime: PROVIDER_LIST_CACHE_MS,
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
    staleTime: PROVIDER_LIST_CACHE_MS,
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
