import { useSyncExternalStore } from "react";
import {
  parseSharedProviderProfile,
  providerApiKeyCredentialRef,
  serializeSharedProviderProfile,
  sharedConfiguredProviderIdsFromEnvKeys,
  sharedProviderCredentialEnvKey,
  sharedProviderIdsFromEnvKeys,
  sharedProviderProfileEnvKey,
  type SharedProviderProfile,
} from "@ipollowork/types/provider-credentials";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { parse } from "jsonc-parser";

import { t } from "../../../../i18n";
import {
  createDenClient,
  readDenSettings,
  type DenOrgLlmProvider,
  type DenOrgLlmProviderConnection,
} from "../../../../app/lib/den";
import {
  engineRestart,
  workspaceiPolloWorkRead,
  workspaceiPolloWorkWrite,
} from "../../../../app/lib/desktop";
import { iPolloWorkServerError } from "../../../../app/lib/ipollowork-server";
import type {
  ProviderListItem,
  ProviderListResponse,
  WorkspaceDisplay,
} from "../../../../app/types";
import { isDesktopRuntime, safeStringify } from "../../../../app/utils";
import {
  compareProviders,
  filterProviderList,
} from "../../../../app/utils/providers";
import { getReactQueryClient } from "../../../infra/query-client";
import {
  ensureProviderListQuery,
  refreshProviderListQueries,
} from "../../../infra/provider-list-query";
import type { iPolloWorkServerStoreSnapshot } from "../ipollowork-server-store";

/**
 * The slice of the ipollowork-server store this store actually consumes.
 * The settings route passes the full store; the session route passes a
 * lightweight endpoint-backed adapter (previously forced through `as never`).
 */
export type ProviderAuthiPolloWorkServer = {
  getSnapshot: () => Pick<
    iPolloWorkServerStoreSnapshot,
    "ipolloworkServerStatus" | "ipolloworkServerClient"
  > & {
    ipolloworkServerCapabilities: { config?: { read?: boolean; write?: boolean } } | null;
  };
};
import {
  denSessionUpdatedEvent,
  type DenSessionUpdatedDetail,
} from "../../../../app/lib/den-session-events";
import {
  readWorkspaceCloudImports,
  withWorkspaceCloudImports,
  type CloudImportedProvider,
} from "../../../../app/cloud/import-state";
import {
  getCloudManagedProviderId,
  getCloudProviderEnv,
  getProviderModelIds,
  isCloudManagedProviderKey,
  isCloudProviderOutOfSync,
  resolveCloudProviderCredentials,
} from "./cloud-provider-config";
import { refreshDesktopCloudSync } from "../../../../app/cloud/desktop-cloud-sync";
import { dispatchNewProviders } from "../../../../app/lib/provider-events";
import {
  DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
  isDesktopProviderBlocked,
  type DesktopAppRestrictionChecker,
} from "../../../../app/cloud/desktop-app-restrictions";
import { TOKENSTAR_PROVIDER, tokenStarRuntimeModels } from "./tokenstar-provider";
import { ORCAROUTER_PROVIDER, orcarouterRuntimeModels } from "./orcarouter-provider";
import {
  modelRuntimeAdapters,
  type CompatibleProviderProfile,
  type ProviderEngineAuthAuthorization,
  type ProviderEngineAuthMethod,
  type ProviderEngineConfigTarget,
} from "./provider-engine-adapter";
import {
  buildSharedProviderProfile,
  sharedProviderConnectionEnvEntries,
} from "./shared-provider-profile";

type ProviderReturnFocusTarget = "none" | "composer";
type CloudProviderSyncReason = "sign_in" | "app_launch" | "interval" | "settings_cloud_opened";

const PROVIDER_ENGINE_CLIENT_WAIT_TIMEOUT_MS = 10_000;
const PROVIDER_ENGINE_CLIENT_WAIT_INTERVAL_MS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingProviderCredentialError(error: unknown): boolean {
  if (error instanceof iPolloWorkServerError) {
    return error.status === 404 && error.code === "env_not_found";
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /not found|unknown auth|env_not_found|\b404\b/i.test(message);
}

function stableConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableConfigValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableConfigValue(value[key])]),
  );
}

function canonicalConfig(raw: string): string | null {
  const parsed: unknown = parse(raw);
  if (parsed === undefined && raw.trim()) return null;
  return JSON.stringify(stableConfigValue(parsed ?? {}));
}

function configsAreSemanticallyEqual(left: string, right: string): boolean {
  if (left === right) return true;
  const leftCanonical = canonicalConfig(left);
  const rightCanonical = canonicalConfig(right);
  return leftCanonical !== null && leftCanonical === rightCanonical;
}

export type ProviderAuthMethod = {
  type: "oauth" | "api" | "cloud";
  label: string;
  methodIndex?: number;
  cloudProviderId?: string;
  description?: string;
  env?: string[];
  modelCount?: number;
};

export type ProviderAuthProvider = {
  id: string;
  name: string;
  env: string[];
};

export type ProviderOAuthStartResult = {
  methodIndex: number;
  authorization: ProviderEngineAuthAuthorization;
};

export type ProviderAuthStoreSnapshot = {
  providerAuthModalOpen: boolean;
  providerAuthBusy: boolean;
  providerAuthError: string | null;
  providerAuthMethods: Record<string, ProviderAuthMethod[]>;
  providerAuthPreferredProviderId: string | null;
  providerAuthWorkerType: "local" | "remote";
  providerAuthProviders: ProviderAuthProvider[];
  connectedProviderIds: string[];
  cloudOrgProviders: DenOrgLlmProvider[];
  importedCloudProviders: Record<string, CloudImportedProvider>;
};

type CreateProviderAuthStoreOptions = {
  client: () => unknown | null;
  providerRuntimeConnections?: () => ReadonlyArray<{
    engineId: string;
    client: unknown;
  }>;
  providers: () => ProviderListItem[];
  providerDefaults: () => Record<string, string>;
  providerConnectedIds: () => string[];
  disabledProviders: () => string[];
  checkDesktopAppRestriction: DesktopAppRestrictionChecker;
  selectedWorkspaceDisplay: () => WorkspaceDisplay;
  providerBaseUrl: () => string;
  selectedWorkspaceRoot: () => string;
  allowCloudImports?: () => boolean;
  deferSharedProviderImport?: () => boolean;
  runtimeWorkspaceId: () => string | null;
  ensureRuntimeWorkspaceId?: () => Promise<string | null | undefined>;
  ipolloworkServer: ProviderAuthiPolloWorkServer;
  providerServer?: ProviderAuthiPolloWorkServer;
  setProviders: (value: ProviderListItem[]) => void;
  setProviderDefaults: (value: Record<string, string>) => void;
  setProviderConnectedIds: (value: string[]) => void;
  setDisabledProviders: (value: string[]) => void;
  markEngineConfigReloadRequired: (configFileName: string) => void;
  focusPromptSoon?: () => void;
};

type ProviderRefreshOptions = {
  dispose?: boolean;
  force?: boolean;
  skipSharedImport?: boolean;
  runtimeEnvironmentChanged?: boolean;
};

function accountProviderCredentialIds(providerId: string): string[] {
  const resolved = providerId.trim().toLowerCase();
  if (!resolved) return [];
  if (resolved === "deepseek" || resolved === "deepseek-official") {
    return ["deepseek-official", "deepseek"];
  }
  return [resolved];
}

type MutableState = {
  providerAuthModalOpen: boolean;
  providerAuthBusy: boolean;
  providerAuthError: string | null;
  providerAuthMethods: Record<string, ProviderAuthMethod[]>;
  providerAuthPreferredProviderId: string | null;
  providerAuthReturnFocusTarget: ProviderReturnFocusTarget;
  accountConnectedProviderIds: string[];
  explicitlyDisconnectedProviderIds: string[];
  cloudOrgProviders: DenOrgLlmProvider[];
  importedCloudProviders: Record<string, CloudImportedProvider>;
};

const QWEN3_CODER_PROVIDER = {
  providerId: "qwen",
  name: "Qwen",
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  modelId: "qwen3-coder-plus",
  modelName: "Qwen3-Coder Plus",
};

const DEEPSEEK_OFFICIAL_PROVIDER = {
  providerId: "deepseek-official",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  models: {
    "deepseek-v4-flash": { name: "DeepSeek-V4-Flash" },
    "deepseek-v4-pro": { name: "DeepSeek-V4-Pro" },
  },
} as const;

function catalogSharedProviderProfile(
  providers: readonly ProviderListItem[],
  providerId: string,
): SharedProviderProfile {
  const provider = providers.find((entry) => entry.id === providerId);
  return buildSharedProviderProfile({
    providerId,
    displayName: provider?.name?.trim() || providerId,
    models: provider?.models ?? {},
  });
}

function cloudSharedProviderProfile(
  provider: DenOrgLlmProviderConnection,
  providerId: string,
): SharedProviderProfile {
  const configuredApi = typeof provider.providerConfig.api === "string"
    ? provider.providerConfig.api.trim()
    : "";
  const optionsBaseURL = isRecord(provider.providerConfig.options)
    && typeof provider.providerConfig.options.baseURL === "string"
    ? provider.providerConfig.options.baseURL.trim()
    : "";
  return buildSharedProviderProfile({
    providerId,
    displayName: provider.name,
    api: configuredApi,
    baseURL: optionsBaseURL,
    npm: typeof provider.providerConfig.npm === "string" ? provider.providerConfig.npm : undefined,
    models: Object.fromEntries(provider.models.map((model) => [model.id, { name: model.name }])),
  });
}

type CompatibleProviderPreset = {
  providerId: string;
  name: string;
  baseURL: string;
  models(modelIds?: string[]): CompatibleProviderProfile["models"];
};

const COMPATIBLE_PROVIDER_PRESETS: CompatibleProviderPreset[] = [
  {
    ...DEEPSEEK_OFFICIAL_PROVIDER,
    models: () => DEEPSEEK_OFFICIAL_PROVIDER.models,
  },
  {
    providerId: QWEN3_CODER_PROVIDER.providerId,
    name: QWEN3_CODER_PROVIDER.name,
    baseURL: QWEN3_CODER_PROVIDER.baseURL,
    models: () => ({
      [QWEN3_CODER_PROVIDER.modelId]: { name: QWEN3_CODER_PROVIDER.modelName },
    }),
  },
  {
    providerId: TOKENSTAR_PROVIDER.providerId,
    name: TOKENSTAR_PROVIDER.name,
    baseURL: TOKENSTAR_PROVIDER.baseURL,
    models: (modelIds) => tokenStarRuntimeModels([
      ...new Set(
        (modelIds?.length ? modelIds : TOKENSTAR_PROVIDER.fallbackModels.map((model) => model.id))
          .map((modelId) => modelId.trim())
          .filter(Boolean),
      ),
    ]),
  },
  {
    providerId: ORCAROUTER_PROVIDER.providerId,
    name: ORCAROUTER_PROVIDER.name,
    baseURL: ORCAROUTER_PROVIDER.baseURL,
    models: (modelIds) => orcarouterRuntimeModels([
      ...new Set(
        (modelIds?.length ? modelIds : ORCAROUTER_PROVIDER.fallbackModels.map((model) => model.id))
          .map((modelId) => modelId.trim())
          .filter(Boolean),
      ),
    ]),
  },
];

function compatibleProviderProfile(
  providerId: string,
  modelIds?: string[],
): CompatibleProviderProfile | null {
  const preset = COMPATIBLE_PROVIDER_PRESETS.find((entry) => entry.providerId === providerId);
  return preset
    ? {
        id: preset.providerId,
        name: preset.name,
        baseURL: preset.baseURL,
        models: preset.models(modelIds),
      }
    : null;
}

export type ProviderAuthStore = ReturnType<typeof createProviderAuthStore>;

export function createProviderAuthStore(options: CreateProviderAuthStoreOptions) {
  const getProviderServerSnapshot = () =>
    (options.providerServer ?? options.ipolloworkServer).getSnapshot();
  const listeners = new Set<() => void>();

  let snapshot: ProviderAuthStoreSnapshot;
  let disposed = false;
  let started = false;
  let denSessionCleanup: (() => void) | null = null;
  let lastWorkspaceKey = "";

  let state: MutableState = {
    providerAuthModalOpen: false,
    providerAuthBusy: false,
    providerAuthError: null,
    providerAuthMethods: {},
    providerAuthPreferredProviderId: null,
    providerAuthReturnFocusTarget: "none",
    accountConnectedProviderIds: [],
    explicitlyDisconnectedProviderIds: [],
    cloudOrgProviders: [],
    importedCloudProviders: {},
  };

  let cloudOrgProvidersLoadKey = "";
  let cloudOrgProvidersInFlightKey = "";
  let cloudOrgProvidersInFlight: Promise<DenOrgLlmProvider[]> | null = null;
  let cloudProviderSyncInFlight: Promise<void> | null = null;
  let cloudProviderSyncQueuedReason: CloudProviderSyncReason | null = null;
  let cloudProviderSyncContextKey = "";
  let sharedProviderImportFingerprint = "";
  let sharedProviderImportInFlight: Promise<{
    changed: boolean;
    requiresReload: boolean;
  }> | null = null;
  let providerRefreshInFlight: Promise<ProviderListResponse | null> | null = null;
  let queuedProviderRefresh: Promise<ProviderListResponse | null> | null = null;
  let queuedProviderRefreshOptions: ProviderRefreshOptions | null = null;

  const emitChange = () => {
    for (const listener of listeners) listener();
   };

  const getProviderAuthWorkerType = (): "local" | "remote" =>
    options.selectedWorkspaceDisplay().workspaceType === "remote" ? "remote" : "local";

  const getProviderEngineAdapter = () =>
    modelRuntimeAdapters.get(options.selectedWorkspaceDisplay().engineId);

  const getProviderEngineConnection = () => {
    const client = options.client();
    if (!client) {
      throw new Error(t("providers.not_connected"));
    }
    return getProviderEngineAdapter().connect(client);
  };

  const waitForProviderEngineConnection = async () => {
    const deadline = Date.now() + PROVIDER_ENGINE_CLIENT_WAIT_TIMEOUT_MS;
    while (!disposed) {
      const client = options.client();
      if (client) {
        const connection = getProviderEngineAdapter().connect(client);
        await connection.waitUntilHealthy();
        return connection;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await new Promise<void>((resolve) => {
        setTimeout(
          resolve,
          Math.min(PROVIDER_ENGINE_CLIENT_WAIT_INTERVAL_MS, remainingMs),
        );
      });
    }

    throw new Error(t("providers.not_connected"));
  };

  const markProviderEngineConfigReloadRequired = () => {
    options.markEngineConfigReloadRequired(getProviderEngineAdapter().configFileName);
  };

  const getProviderAuthProviders = (): ProviderAuthProvider[] => {
    const merged = new Map<string, ProviderAuthProvider>();

    for (const provider of options.providers()) {
      const id = provider.id?.trim();
      if (!id) continue;
      if (isDesktopProviderBlocked({ providerId: id, checkRestriction: options.checkDesktopAppRestriction })) continue;
      merged.set(id, {
        id,
        name: provider.name?.trim() || id,
        env: Array.isArray(provider.env) ? provider.env : [],
      });
    }

    if (
      !merged.has(DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID) &&
      !isDesktopProviderBlocked({
        providerId: DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      merged.set(DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID, {
        id: DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
        name: "iPolloWork Built-in Models",
        env: [],
      });
    }

    if (getProviderEngineAdapter().capabilities.cloudProviderImports) {
      for (const provider of state.cloudOrgProviders) {
        const id = provider.providerId.trim();
        if (!id || merged.has(id)) continue;
        if (isDesktopProviderBlocked({ providerId: id, checkRestriction: options.checkDesktopAppRestriction })) continue;
        merged.set(id, {
          id,
          name: provider.name.trim() || id,
          env: getCloudProviderEnv(provider.providerConfig),
        });
      }
    }

    if (getProviderEngineAdapter().capabilities.customProviders) {
      for (const provider of COMPATIBLE_PROVIDER_PRESETS) {
        if (
          merged.has(provider.providerId)
          || isDesktopProviderBlocked({
            providerId: provider.providerId,
            checkRestriction: options.checkDesktopAppRestriction,
          })
        ) continue;
        merged.set(provider.providerId, {
          id: provider.providerId,
          name: provider.name,
          env: [],
        });
      }
    }

    return Array.from(merged.values()).toSorted(compareProviders);
  };

  const resolveiPolloWorkConfigTarget = async (mode: "read" | "write") => {
    const ipolloworkSnapshot = getProviderServerSnapshot();
    const ipolloworkClient = ipolloworkSnapshot.ipolloworkServerClient;
    let ipolloworkWorkspaceId = options.runtimeWorkspaceId()?.trim() || null;
    if (!ipolloworkWorkspaceId && ipolloworkSnapshot.ipolloworkServerStatus === "connected" && ipolloworkClient) {
      ipolloworkWorkspaceId = (await options.ensureRuntimeWorkspaceId?.())?.trim() || null;
    }
    const hasiPolloWorkTarget =
      ipolloworkSnapshot.ipolloworkServerStatus === "connected" &&
      Boolean(ipolloworkClient && ipolloworkWorkspaceId);
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.config?.[mode] !== false;
    return {
      ipolloworkClient,
      ipolloworkWorkspaceId,
      hasiPolloWorkTarget,
      canUseiPolloWorkServer,
    };
  };

  const resolveProviderEngineConfigTarget = async (
    mode: "read" | "write",
  ): Promise<ProviderEngineConfigTarget> => {
    const target = await resolveiPolloWorkConfigTarget(mode);
    return {
      ...target,
      workspaceId: target.ipolloworkWorkspaceId,
      isLocalWorkspace: options.selectedWorkspaceDisplay().workspaceType === "local",
      root: options.selectedWorkspaceRoot().trim(),
    };
  };

  const refreshSnapshot = () => {
    const configuredRuntimeProviderIds = new Set(
      options.providers().flatMap((provider) => (
        provider.id.trim().toLowerCase() === DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID
        || provider.source !== "env"
          ? [provider.id]
          : []
      )),
    );
    const disabledProviderIds = new Set(options.disabledProviders());
    const explicitlyDisconnectedProviderIds = new Set(
      state.explicitlyDisconnectedProviderIds,
    );
    snapshot = {
      providerAuthModalOpen: state.providerAuthModalOpen,
      providerAuthBusy: state.providerAuthBusy,
      providerAuthError: state.providerAuthError,
      providerAuthMethods: state.providerAuthMethods,
      providerAuthPreferredProviderId: state.providerAuthPreferredProviderId,
      providerAuthWorkerType: getProviderAuthWorkerType(),
      providerAuthProviders: getProviderAuthProviders(),
      connectedProviderIds: [
        ...new Set([
          ...(!isDesktopProviderBlocked({
            providerId: DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
            checkRestriction: options.checkDesktopAppRestriction,
          })
            ? [DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID]
            : []),
          ...options.providerConnectedIds().filter((providerId) => configuredRuntimeProviderIds.has(providerId)),
          ...state.accountConnectedProviderIds,
        ].filter((providerId) => (
          !disabledProviderIds.has(providerId)
          && !explicitlyDisconnectedProviderIds.has(providerId.trim().toLowerCase())
        ))),
      ],
      cloudOrgProviders: state.cloudOrgProviders,
      importedCloudProviders: state.importedCloudProviders,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(
    key: K,
    value: MutableState[K],
  ) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const setProvidersExplicitlyDisconnected = (
    providerIds: readonly string[],
    disconnected: boolean,
  ) => {
    const affectedProviderIds = new Set(
      providerIds
        .flatMap(accountProviderCredentialIds)
        .map((providerId) => providerId.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!affectedProviderIds.size) return;
    const nextProviderIds = disconnected
      ? [...new Set([
          ...state.explicitlyDisconnectedProviderIds,
          ...affectedProviderIds,
        ])].sort()
      : state.explicitlyDisconnectedProviderIds.filter(
          (providerId) => !affectedProviderIds.has(providerId),
        );
    if (
      nextProviderIds.length === state.explicitlyDisconnectedProviderIds.length
      && nextProviderIds.every(
        (providerId, index) => providerId === state.explicitlyDisconnectedProviderIds[index],
      )
    ) {
      return;
    }
    setStateField("explicitlyDisconnectedProviderIds", nextProviderIds);
  };

  const buildCloudProviderMethod = (
    provider: DenOrgLlmProvider,
  ): ProviderAuthMethod => ({
    type: "cloud",
    label:
      provider.name.trim().toLowerCase() ===
      provider.providerId.trim().toLowerCase()
        ? "Use organization provider"
        : `Use ${provider.name}`,
    cloudProviderId: provider.id,
    description:
      provider.models.length > 0
        ? `${provider.models.length} curated model${
            provider.models.length === 1 ? "" : "s"
          } managed by your organization.`
        : "Use the provider and credential managed by your organization.",
    env: getCloudProviderEnv(provider.providerConfig),
    modelCount: provider.models.length,
  });

  const readCloudProviderBaseUrl = (provider: DenOrgLlmProviderConnection) => {
    const options = provider.providerConfig.options;
    if (options && typeof options === "object" && !Array.isArray(options)) {
      const baseURL = "baseURL" in options ? options.baseURL : undefined;
      if (typeof baseURL === "string" && baseURL.trim()) return baseURL.trim().replace(/\/api\/v1\/?$/, "");
    }
    const api = provider.providerConfig.api;
    if (typeof api === "string" && api.trim()) return api.trim().replace(/\/api\/v1\/?$/, "");
    return "";
  };

  const mirroriPolloWorkModelsVoiceEnv = async (provider: DenOrgLlmProviderConnection, apiKey: string) => {
    if (provider.source !== "ipollowork" || !apiKey.trim()) return;
    const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
    if (!ipolloworkClient) return;
    const baseUrl = readCloudProviderBaseUrl(provider);
    const entries = [{ key: "IPOLLOWORK_API_KEY", value: apiKey.trim() }];
    if (baseUrl) entries.push({ key: "IPOLLOWORK_INFERENCE_BASE_URL", value: baseUrl });
    await ipolloworkClient.upsertUserEnv(entries);
  };

  const readWorkspaceiPolloWorkConfigRecord = async (): Promise<
    Record<string, unknown>
  > => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace =
      options.selectedWorkspaceDisplay().workspaceType === "local";
    const { ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget, canUseiPolloWorkServer } =
      await resolveiPolloWorkConfigTarget("read");

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      const config = await ipolloworkClient.getConfig(ipolloworkWorkspaceId);
      return config.ipollowork ?? {};
    }

    if (hasiPolloWorkTarget) {
      return {};
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      return (await workspaceiPolloWorkRead({
        workspacePath: root,
      })) as unknown as Record<string, unknown>;
    }

    return {};
  };

  const writeWorkspaceiPolloWorkConfigRecord = async (
    config: Record<string, unknown>,
  ) => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace =
      options.selectedWorkspaceDisplay().workspaceType === "local";
    const { ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget, canUseiPolloWorkServer } =
      await resolveiPolloWorkConfigTarget("write");

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      await ipolloworkClient.patchConfig(ipolloworkWorkspaceId, { ipollowork: config });
      return true;
    }

    if (hasiPolloWorkTarget) {
      return false;
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      const result = await workspaceiPolloWorkWrite({
        workspacePath: root,
        config: config as never,
      });
      const typed = result as { ok: boolean; stderr?: string; stdout?: string };
      if (!typed.ok) {
        throw new Error(
          typed.stderr || typed.stdout || "Failed to write .opencode/ipollowork.json",
        );
      }
      return true;
    }

    return false;
  };

  const refreshImportedCloudProviders = async (refreshOptions?: { strict?: boolean }) => {
    try {
      const config = await readWorkspaceiPolloWorkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      const next = cloudImports.providers;
      // Guard: don't overwrite non-empty import state with an empty read.
      // This prevents a transient server unavailability (e.g. during engine
      // restart) from clearing a just-completed import from the badge.
      const hasNext = Object.keys(next).length > 0;
      const hasCurrent = Object.keys(state.importedCloudProviders).length > 0;
      if (hasNext || !hasCurrent) {
        setStateField("importedCloudProviders", next);
      }
      return next;
    } catch (error) {
      if (refreshOptions?.strict) {
        throw error;
      }
      // Preserve existing state on read failure to avoid losing import state.
      return state.importedCloudProviders;
    }
  };

  const persistImportedCloudProviders = async (
    nextProviders: Record<string, CloudImportedProvider>,
  ) => {
    const config = await readWorkspaceiPolloWorkConfigRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextCloudImports = {
      ...cloudImports,
      providers: nextProviders,
    };
    const nextConfig = withWorkspaceCloudImports(config, {
      ...nextCloudImports,
    });
    const persisted = await writeWorkspaceiPolloWorkConfigRecord(nextConfig);
    if (!persisted) {
      throw new Error(
        "iPolloWork server unavailable. Connect to manage imported cloud providers.",
      );
    }
    setStateField("importedCloudProviders", nextProviders);
    const target = await resolveiPolloWorkConfigTarget("write");
    void refreshDesktopCloudSync({
      ipolloworkClient: target.ipolloworkClient,
      workspaceId: target.ipolloworkWorkspaceId,
    }).catch(() => null);
  };

  const readProjectConfigFile = async () => {
    const target = await resolveProviderEngineConfigTarget("read");
    return getProviderEngineAdapter().readProjectConfig(target);
  };

  const writeProjectConfigFile = async (content: string) => {
    const target = await resolveProviderEngineConfigTarget("write");
    return getProviderEngineAdapter().writeProjectConfig(target, content);
  };

  /**
   * Upsert/delete cloud-managed provider entries in the workspace's runtime
   * engine config. Record values upsert and explicit `null` deletes per key,
   * so there is no read-modify-write race or edit of user-owned config.
   */
  const patchRuntimeProviders = async (update: Record<string, unknown>) => {
    const target = await resolveProviderEngineConfigTarget("write");
    await getProviderEngineAdapter().patchRuntimeProviders(target, update);
  };

  const updateProjectConfigFile = async (
    updater: (raw: string) => string,
  ) => {
    const configFile = await readProjectConfigFile() as { content?: string } | null;
    if (configFile) {
      const raw = configFile.content?.trim()
        ? configFile.content
        : getProviderEngineAdapter().emptyProjectConfig();
      const next = updater(raw);
      if (configsAreSemanticallyEqual(raw, next)) {
        return false;
      }
      await writeProjectConfigFile(next);
      return true;
    }
    return false;
  };

  const ensureProjectProviderDisabledState = async (
    providerId: string,
    disabled: boolean,
  ) => {
    const resolvedProviderId = providerId.trim();
    if (!resolvedProviderId) {
      throw new Error(t("providers.provider_id_required"));
    }

    const currentDisabled = [
      ...new Set(options.disabledProviders().map((entry) => entry.trim()).filter(Boolean)),
    ];
    const nextDisabled = disabled
      ? [...currentDisabled.filter((entry) => entry !== resolvedProviderId), resolvedProviderId]
      : currentDisabled.filter((entry) => entry !== resolvedProviderId);

    if (
      nextDisabled.length === currentDisabled.length &&
      nextDisabled.every((entry, index) => entry === currentDisabled[index])
    ) {
      return false;
    }

    const updatedProjectConfig = await updateProjectConfigFile((raw) =>
      getProviderEngineAdapter().formatProjectProviderDisabledState(
        raw,
        resolvedProviderId,
        disabled,
      ),
    );

    if (!updatedProjectConfig) {
      await getProviderEngineConnection().writeDisabledProviders(nextDisabled);
    }

    options.setDisabledProviders(nextDisabled);
    markProviderEngineConfigReloadRequired();
    refreshSnapshot();
    emitChange();
    return true;
  };

  const assertProviderAllowedByDesktopPolicy = (providerId: string) => {
    if (
      isDesktopProviderBlocked({
        providerId,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      throw new Error(`${providerId} is blocked by your organization desktop policy.`);
    }
  };

  // Sweep all cloud-managed provider entries (keys matching /^lpr_/) from the
  // single runtime-owned provider config, regardless of imported state.
  const sweepOrphanCloudProvidersFromRuntime = async (): Promise<string[]> => {
    const orphanIds = new Set<string>();

    try {
      const target = await resolveProviderEngineConfigTarget("write");
      const runtimeOrphans = (await getProviderEngineAdapter().runtimeProviderIds(target))
        .filter((key) => /^lpr_/i.test(key));
      if (runtimeOrphans.length > 0) {
        await patchRuntimeProviders(
          Object.fromEntries(runtimeOrphans.map((id) => [id, null])),
        );
        for (const id of runtimeOrphans) orphanIds.add(id);
      }
    } catch {
      // Best-effort cleanup; tracked entries are still removed individually.
    }

    return [...orphanIds];
  };

  const assertCloudProviderImportSafe = async (
    provider: DenOrgLlmProviderConnection,
  ) => {
    const localProviderId = getCloudManagedProviderId(provider);
    const existingImported = state.importedCloudProviders[provider.id] ?? null;
    // `lpr_*` / `ipollowork` keys are owned by the cloud-import system. When the
    // import baseline was lost or diverged (e.g. it lives in a different file
    // than the provider block, or a prior reconcile failed mid-flight), an
    // existing cloud-managed block must be treated as a re-import to reconcile,
    // not blocked. Only guard against clobbering a user's manual provider.
    const cloudManagedKey = isCloudManagedProviderKey(localProviderId);
    if (
      existingImported &&
      existingImported.providerId !== localProviderId &&
      Object.values(state.importedCloudProviders).some(
        (entry) => entry.providerId === localProviderId && entry.cloudProviderId !== provider.id,
      )
    ) {
      throw new Error(
        `${localProviderId} is already imported from another cloud provider. Remove it before importing this one.`,
      );
    }

    if (
      !existingImported &&
      !cloudManagedKey &&
      options.providerConnectedIds().includes(localProviderId)
    ) {
      throw new Error(
        `${localProviderId} is already connected in this workspace. Disconnect it before importing the cloud-managed version.`,
      );
    }

    const configFile = await readProjectConfigFile() as { content?: string } | null;
    if (!configFile?.content?.trim() || existingImported || cloudManagedKey) {
      return;
    }

    if (getProviderEngineAdapter().projectProviderIds(configFile.content).includes(localProviderId)) {
      throw new Error(
        `${localProviderId} already has a provider block in ${getProviderEngineAdapter().configFileName}. Remove it before importing the cloud-managed version.`,
      );
    }
  };

  const getCloudOrgProvidersKey = () => {
    const settings = readDenSettings();
    return [
      settings.baseUrl,
      settings.activeOrgId?.trim() ?? "",
      settings.authToken?.trim() ?? "",
    ].join("::");
  };

  const refreshCloudOrgProviders = async (optionsArg?: { force?: boolean }) => {
    const settings = readDenSettings();
    const loadKey = getCloudOrgProvidersKey();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";

    if (!optionsArg?.force && cloudOrgProvidersLoadKey === loadKey) {
      return state.cloudOrgProviders;
    }

    if (cloudOrgProvidersInFlight && cloudOrgProvidersInFlightKey === loadKey) {
      return cloudOrgProvidersInFlight;
    }

    if (!token || !orgId) {
      setStateField("cloudOrgProviders", []);
      cloudOrgProvidersLoadKey = loadKey;
      return [];
    }

    const client = createDenClient({
      baseUrl: settings.baseUrl,
      token,
    });
    const request = client
      .listOrgLlmProviders(orgId)
      .then((providers) => {
        setStateField("cloudOrgProviders", providers);
        cloudOrgProvidersLoadKey = loadKey;
        return providers;
      })
      .catch((error) => {
        setStateField("cloudOrgProviders", []);
        cloudOrgProvidersLoadKey = "";
        throw error;
      })
      .finally(() => {
        if (cloudOrgProvidersInFlightKey === loadKey) {
          cloudOrgProvidersInFlight = null;
          cloudOrgProvidersInFlightKey = "";
        }
      });

    cloudOrgProvidersInFlight = request;
    cloudOrgProvidersInFlightKey = loadKey;
    return request;
  };

  // Track whether the provider list has been loaded at least once.
  // The first load (app startup) populates the initial state — we don't
  // want to fire "new provider" events for providers that were already
  // there. After the first load, any new provider IS genuinely new.
  let providerListInitialized = false;

  const applyProviderListState = (value: ProviderListResponse, opts?: { suppressNewProviderEvent?: boolean }) => {
    const prevConnected = new Set(options.providerConnectedIds());
    const nextConnected = value.connected ?? [];
    const nextAll = value.all ?? [];
    options.setProviders(nextAll);
    options.setProviderDefaults(value.default ?? {});
    options.setProviderConnectedIds(nextConnected);
    refreshSnapshot();
    emitChange();

    if (!providerListInitialized) {
      providerListInitialized = true;
      return;
    }

    // Detect newly connected providers and fire a global event so
    // the NewProvidersListener records a notification — regardless of
    // which route is active.
    if (!opts?.suppressNewProviderEvent) {
      const newIds = nextConnected.filter((id) => !prevConnected.has(id));
      if (newIds.length > 0) {
        const infos = newIds.map((id) => {
          const provider = nextAll.find((p) => (p.id ?? "") === id);
          const models = provider?.models ?? {};
          const firstModelId = Object.keys(models)[0];
          return {
            id,
            name: provider?.name ?? id,
            providerId: id,
            firstModelId,
            firstModelName: firstModelId
              ? (models[firstModelId]?.name ?? firstModelId)
              : undefined,
          };
        });
        dispatchNewProviders({ providers: infos, source: "local_config" });
      }
    }
  };

  const removeProviderFromState = (providerIds: readonly string[]) => {
    const removedProviderIds = new Set(
      providerIds.map((providerId) => providerId.trim().toLowerCase()).filter(Boolean),
    );
    if (!removedProviderIds.size) return;
    options.setProviders(options.providers().filter(
      (provider) => !removedProviderIds.has(provider.id.trim().toLowerCase()),
    ));
    options.setProviderConnectedIds(
      options.providerConnectedIds().filter(
        (id) => !removedProviderIds.has(id.trim().toLowerCase()),
      ),
    );
    options.setProviderDefaults(
      Object.fromEntries(
        Object.entries(options.providerDefaults()).filter(
          ([id]) => !removedProviderIds.has(id.trim().toLowerCase()),
        ),
      ),
    );
    setProvidersExplicitlyDisconnected([...removedProviderIds], true);
    refreshSnapshot();
    emitChange();
  };

  const removeProviderAuthCredentials = async (providerId: string) => {
    const providerIds = accountProviderCredentialIds(providerId);
    const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
    const removesAccountConnection = state.accountConnectedProviderIds.some((providerId) => (
      providerIds.includes(providerId.trim().toLowerCase())
    ));
    if (removesAccountConnection && !ipolloworkClient) {
      // Hiding the provider only in renderer state makes it reappear on the
      // next launch. An account-owned connection is disconnected only after
      // its durable credential/profile store is reachable.
      throw new Error(t("providers.disconnect_failed"));
    }
    const activeClient = options.client();
    const activeEngineId = getProviderEngineAdapter().id;
    const runtimeConnections = [
      ...(activeClient ? [{ engineId: activeEngineId, client: activeClient }] : []),
      ...(options.providerRuntimeConnections?.() ?? []),
    ].filter((entry, index, entries) => entries.findIndex((candidate) => (
      candidate.engineId === entry.engineId && candidate.client === entry.client
    )) === index);

    for (const [index, runtime] of runtimeConnections.entries()) {
      const connection = modelRuntimeAdapters.get(runtime.engineId).connect(runtime.client);
      for (const credentialProviderId of providerIds) {
        try {
          await connection.removeCredentials(credentialProviderId);
        } catch (error) {
          // The active account control plane owns OAuth credentials, so a real
          // failure there must remain visible. Other runtimes only cache the
          // shared account key and can reconcile on their next provider read.
          if (index === 0 && !isMissingProviderCredentialError(error)) throw error;
        }
      }
    }

    if (ipolloworkClient) {
      const providerEnvKeys = getProviderAuthProviders()
        .filter((provider) => providerIds.includes(provider.id.trim().toLowerCase()))
        .flatMap((provider) => provider.env.filter((key) => key.trim()));
      await Promise.all(
        [...new Set(providerIds.flatMap((credentialProviderId) => [
          sharedProviderCredentialEnvKey(credentialProviderId),
          sharedProviderProfileEnvKey(credentialProviderId),
          providerApiKeyCredentialRef(credentialProviderId),
          ...providerEnvKeys,
        ]))].map(async (key) => {
          try {
            await ipolloworkClient.deleteUserEnv(key);
          } catch (error) {
            if (!isMissingProviderCredentialError(error)) throw error;
          }
        }),
      );
      setStateField(
        "accountConnectedProviderIds",
        state.accountConnectedProviderIds.filter(
          (id) => !providerIds.includes(id.trim().toLowerCase()),
        ),
      );
    }
    return providerIds;
  };

  const mirrorSharedProviderConnection = async (
    apiKey: string,
    profile: SharedProviderProfile,
  ) => {
    const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
    if (!ipolloworkClient) return;
    await ipolloworkClient.upsertUserEnv(sharedProviderConnectionEnvEntries({ apiKey, profile }));
    setStateField(
      "accountConnectedProviderIds",
      [...new Set([...state.accountConnectedProviderIds, profile.providerId])],
    );
    await refreshProviderListQueries(getReactQueryClient());
  };

  const mirrorSharedProviderProfile = async (profile: SharedProviderProfile) => {
    const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
    if (!ipolloworkClient) return;
    await ipolloworkClient.upsertUserEnv([{
      key: sharedProviderProfileEnvKey(profile.providerId),
      value: serializeSharedProviderProfile(profile),
    }]);
    setStateField(
      "accountConnectedProviderIds",
      [...new Set([...state.accountConnectedProviderIds, profile.providerId])].sort(),
    );
    await refreshProviderListQueries(getReactQueryClient());
  };

  const refreshAccountConnectedProviderIds = async () => {
    const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
    if (!ipolloworkClient) return null;
    const { keys, oauthProviderIds } = await ipolloworkClient.listUserEnvKeys();
    const providerIds = [
      ...new Set([
        ...sharedConfiguredProviderIdsFromEnvKeys(keys, oauthProviderIds),
      ]),
    ].sort();
    if (
      providerIds.length !== state.accountConnectedProviderIds.length ||
      providerIds.some((providerId, index) => providerId !== state.accountConnectedProviderIds[index])
    ) {
      setStateField("accountConnectedProviderIds", providerIds);
    }
    return keys;
  };

  const reloadProviderEngine = async (
    client: unknown,
    optionsArg?: { runtimeEnvironmentChanged?: boolean },
  ) => {
    const authChangesRequireReload = getProviderEngineAdapter().capabilities.authChangesRequireReload;
    if (!authChangesRequireReload && !optionsArg?.runtimeEnvironmentChanged) return false;

    // Prefer the iPolloWork server engine reload: it disposes the engine AND
    // re-registers runtime-DB MCPs, so non-primary workspaces and pending
    // changes are picked up instead of silently dropping (toggles "turn
    // off").
    let reloaded = false;
    if (optionsArg?.runtimeEnvironmentChanged && isDesktopRuntime()) {
      try {
        // A running agent process cannot have its environment mutated from the
        // renderer. Restart the desktop-owned runtime after EnvService has
        // updated process.env so every engine child inherits the same account
        // provider state.
        await engineRestart({});
        // The old engine client points at the process we just replaced. Let
        // the normal connection lifecycle attach to the new endpoint instead
        // of querying the stale client below.
        return true;
      } catch {
        // Fall through to the lightweight engine reload when a full desktop
        // runtime restart is unavailable.
      }
    }
    try {
      const ipolloworkSnapshot = getProviderServerSnapshot();
      const ipolloworkClient = ipolloworkSnapshot.ipolloworkServerClient;
      if (!reloaded && ipolloworkSnapshot.ipolloworkServerStatus === "connected" && ipolloworkClient) {
        const workspaceId =
          options.runtimeWorkspaceId()?.trim() ||
          (await options.ensureRuntimeWorkspaceId?.())?.trim() ||
          "";
        if (workspaceId) {
          try {
            await ipolloworkClient.reloadEngine(workspaceId);
          } catch (error) {
            const unreachable =
              error instanceof iPolloWorkServerError && error.code === "opencode_engine_unreachable";
            if (!unreachable || !isDesktopRuntime()) {
              throw error;
            }
            await engineRestart({});
          }
          reloaded = true;
        }
      }
    } catch {
      // fall back to a direct engine dispose below
    }

    if (!reloaded) {
      try {
        await getProviderEngineAdapter().connect(client).dispose();
      } catch {
        // ignore dispose failures and try reading current state anyway
      }
    }

    try {
      const activeClient = options.client() ?? client;
      await getProviderEngineAdapter().connect(activeClient).waitUntilHealthy();
    } catch {
      // ignore health wait failures and still attempt provider reads
    }
    return false;
  };

  const importSharedProviderConnections = (keys: readonly string[]) => {
    if (sharedProviderImportInFlight) return sharedProviderImportInFlight;
    sharedProviderImportInFlight = (async () => {
      const adapter = getProviderEngineAdapter();
      if (adapter.id !== DEFAULT_ENGINE_ID) {
        return { changed: false, requiresReload: false };
      }
      const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
      const engineClient = options.client();
      if (!ipolloworkClient || !engineClient) {
        return { changed: false, requiresReload: false };
      }
      const keySet = new Set(keys);
      const providerIds = sharedProviderIdsFromEnvKeys(keys);
      const connections = await Promise.all(providerIds.map(async (providerId) => {
        const credentialKey = sharedProviderCredentialEnvKey(providerId);
        const profileKey = sharedProviderProfileEnvKey(providerId);
        const [credential, profile] = await Promise.all([
          ipolloworkClient.getUserEnv(credentialKey),
          keySet.has(profileKey) ? ipolloworkClient.getUserEnv(profileKey) : null,
        ]);
        return {
          providerId,
          apiKey: credential.item.value.trim(),
          profile: profile ? parseSharedProviderProfile(profile.item.value) : null,
        };
      }));
      const fingerprint = JSON.stringify({ workspace: currentWorkspaceKey(), connections });
      if (fingerprint === sharedProviderImportFingerprint) {
        return { changed: false, requiresReload: false };
      }

      const target = await resolveProviderEngineConfigTarget("read");
      const runtimeProviderIds = new Set(await adapter.runtimeProviderIds(target));
      let runtimeConfigChanged = false;
      for (const entry of connections) {
        if (!entry.apiKey) continue;
        const profile = entry.profile;
        if (profile?.baseURL && !runtimeProviderIds.has(entry.providerId)) {
          await patchRuntimeProviders(
            adapter.buildCompatibleProviderPatch({
              id: entry.providerId,
              name: profile.displayName,
              baseURL: profile.baseURL,
              models: Object.fromEntries(
                profile.models.map((model) => [model.id, { name: model.name ?? model.id }]),
              ),
            }),
          );
          runtimeProviderIds.add(entry.providerId);
          runtimeConfigChanged = true;
        }
      }

      // A provider added to runtime config is not addressable through the
      // currently running engine. Reload first, then acquire a fresh
      // connection and write all credentials.
      if (runtimeConfigChanged) {
        await reloadProviderEngine(engineClient);
      }
      const activeClient = options.client() ?? engineClient;
      const connection = adapter.connect(activeClient);
      let credentialsChanged = false;
      for (const entry of connections) {
        if (!entry.apiKey) continue;
        await connection.setApiKey(entry.providerId, entry.apiKey);
        credentialsChanged = true;
      }
      if (credentialsChanged) {
        await reloadProviderEngine(activeClient);
      }
      sharedProviderImportFingerprint = fingerprint;
      return { changed: connections.length > 0, requiresReload: false };
    })().finally(() => {
      sharedProviderImportInFlight = null;
    });
    return sharedProviderImportInFlight;
  };

  const describeProviderError = (error: unknown, fallback: string) => {
    const readString = (value: unknown, max = 700) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.length <= max) return trimmed;
      return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
    };

    const records: Record<string, unknown>[] = [];
    const root = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
    if (root) {
      records.push(root);
      if (root.data && typeof root.data === "object") {
        records.push(root.data as Record<string, unknown>);
      }
      if (root.cause && typeof root.cause === "object") {
        const cause = root.cause as Record<string, unknown>;
        records.push(cause);
        if (cause.data && typeof cause.data === "object") {
          records.push(cause.data as Record<string, unknown>);
        }
      }
    }

    const firstString = (keys: string[]) => {
      for (const record of records) {
        for (const key of keys) {
          const value = readString(record[key]);
          if (value) return value;
        }
      }
      return null;
    };

    const firstNumber = (keys: string[]) => {
      for (const record of records) {
        for (const key of keys) {
          const value = record[key];
          if (typeof value === "number" && Number.isFinite(value)) return value;
        }
      }
      return null;
    };

    const status = firstNumber(["statusCode", "status"]);
    const provider = firstString(["providerID", "providerId", "provider"]);
    const code = firstString(["code", "errorCode"]);
    const response = firstString(["responseBody", "body", "response"]);
    const raw =
      (error instanceof Error ? readString(error.message) : null) ||
      firstString(["message", "detail", "reason", "error"]) ||
      (typeof error === "string" ? readString(error) : null);

    const generic = raw && /^unknown\s+error$/i.test(raw);
    const heading = (() => {
      if (status === 401 || status === 403) return t("providers.auth_failed");
      if (status === 429) return t("providers.rate_limit_exceeded");
      if (provider) return t("providers.provider_error", { provider });
      return fallback;
    })();

    const lines = [heading];
    if (raw && !generic && raw !== heading) lines.push(raw);
    if (status && !heading.includes(String(status))) lines.push(`Status: ${status}`);
    if (provider && !heading.includes(provider)) lines.push(`Provider: ${provider}`);
    if (code) lines.push(`Code: ${code}`);
    if (response) lines.push(`Response: ${response}`);
    if (lines.length > 1) return lines.join("\n");

    if (raw && !generic) return raw;
    if (error && typeof error === "object") {
      const serialized = safeStringify(error);
      if (serialized && serialized !== "{}") return serialized;
    }
    return fallback;
  };

  const buildProviderAuthMethods = (
    methods: Record<string, ProviderEngineAuthMethod[]>,
    availableProviders: ProviderAuthProvider[],
    workerType: "local" | "remote",
    cloudProviders: DenOrgLlmProvider[],
  ) => {
    const merged = Object.fromEntries(
      Object.entries(methods ?? {}).map(([id, providerMethods]) => [
        id,
        (providerMethods ?? []).map((method, methodIndex) => ({
          ...method,
          methodIndex,
        })),
      ]),
    ) as Record<string, ProviderAuthMethod[]>;

    for (const provider of availableProviders ?? []) {
      const id = provider.id?.trim();
      if (!id) continue;
      if (isDesktopProviderBlocked({ providerId: id, checkRestriction: options.checkDesktopAppRestriction })) continue;
      if (!Array.isArray(provider.env) || provider.env.length === 0) continue;
      const existing = merged[id] ?? [];
      if (existing.some((method) => method.type === "api")) continue;
      merged[id] = [...existing, { type: "api", label: t("providers.api_key_label") }];
    }

    if (
      getProviderEngineAdapter().capabilities.customProviders &&
      !isDesktopProviderBlocked({
        providerId: DEEPSEEK_OFFICIAL_PROVIDER.providerId,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      const existing = merged[DEEPSEEK_OFFICIAL_PROVIDER.providerId] ?? [];
      if (!existing.some((method) => method.type === "api")) {
        merged[DEEPSEEK_OFFICIAL_PROVIDER.providerId] = [
          ...existing,
          {
            type: "api",
            label: t("providers.api_key_label"),
            description: "Connect DeepSeek once and use it from every supported agent engine.",
          },
        ];
      }
    }

    if (
      getProviderEngineAdapter().capabilities.customProviders &&
      !isDesktopProviderBlocked({
        providerId: QWEN3_CODER_PROVIDER.providerId,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      const existing = merged[QWEN3_CODER_PROVIDER.providerId] ?? [];
      if (!existing.some((method) => method.type === "api")) {
        merged[QWEN3_CODER_PROVIDER.providerId] = [
          ...existing,
          { type: "api", label: t("providers.api_key_label") },
        ];
      }
    }

    if (
      getProviderEngineAdapter().capabilities.customProviders &&
      !isDesktopProviderBlocked({
        providerId: TOKENSTAR_PROVIDER.providerId,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      const existing = merged[TOKENSTAR_PROVIDER.providerId] ?? [];
      if (!existing.some((method) => method.type === "api")) {
        merged[TOKENSTAR_PROVIDER.providerId] = [
          ...existing,
          {
            type: "api",
            label: t("providers.api_key_label"),
            description: "Connect TokenStar with an API key and choose the models to expose.",
          },
        ];
      }
    }

    if (
      getProviderEngineAdapter().capabilities.customProviders &&
      !isDesktopProviderBlocked({
        providerId: ORCAROUTER_PROVIDER.providerId,
        checkRestriction: options.checkDesktopAppRestriction,
      })
    ) {
      const existing = merged[ORCAROUTER_PROVIDER.providerId] ?? [];
      if (!existing.some((method) => method.type === "api")) {
        merged[ORCAROUTER_PROVIDER.providerId] = [
          ...existing,
          {
            type: "api",
            label: t("providers.api_key_label"),
            description: "Connect OrcaRouter with an API key and use it from every supported agent engine.",
          },
        ];
      }
    }

    const availableProvidersById = new Map((availableProviders ?? []).map((provider) => [provider.id, provider]));
    for (const [id, providerMethods] of Object.entries(merged)) {
      if (isDesktopProviderBlocked({ providerId: id, checkRestriction: options.checkDesktopAppRestriction })) {
        delete merged[id];
        continue;
      }
      const provider = availableProvidersById.get(id);
      const normalizedId = id.trim().toLowerCase();
      const normalizedName = provider?.name?.trim().toLowerCase() ?? "";
      const isOpenAiProvider = normalizedId === "openai" || normalizedName === "openai";
      if (!isOpenAiProvider) continue;
      merged[id] = providerMethods.filter((method) => {
        if (method.type !== "oauth") return true;
        const label = method.label.toLowerCase();
        const isHeadless = /headless|device/.test(label);
        return workerType === "remote" ? isHeadless : !isHeadless;
      });
    }

    if (getProviderEngineAdapter().capabilities.cloudProviderImports) {
      for (const provider of cloudProviders) {
        const id = provider.providerId.trim();
        if (!id) continue;
        if (isDesktopProviderBlocked({ providerId: id, checkRestriction: options.checkDesktopAppRestriction })) continue;
        const existing = merged[id] ?? [];
        if (
          existing.some(
            (method) =>
              method.type === "cloud" && method.cloudProviderId === provider.id,
          )
        ) {
          continue;
        }
        merged[id] = [...existing, buildCloudProviderMethod(provider)];
      }
    }

    return merged;
  };

  const loadProviderAuthMethods = async (workerType: "local" | "remote") => {
    // Settings can render before the managed provider sidecar has finished
    // starting. Treat that short window as loading instead of a permanent
    // connection failure, then use the runtime adapter's canonical health
    // check before requesting authentication methods.
    const connection = await waitForProviderEngineConnection();
    const methods = await connection.listAuthMethods();
    const cloudProviders = getProviderEngineAdapter().capabilities.cloudProviderImports
      ? await refreshCloudOrgProviders().catch(() => [] as DenOrgLlmProvider[])
      : [];
    return buildProviderAuthMethods(
      methods,
      getProviderAuthProviders(),
      workerType,
      cloudProviders,
    );
  };

  async function startProviderAuth(
    providerId?: string,
    methodIndex?: number,
  ): Promise<ProviderOAuthStartResult> {
    setStateField("providerAuthError", null);
    const connection = getProviderEngineConnection();
    try {
      const cachedMethods = state.providerAuthMethods;
      const authMethods = Object.keys(cachedMethods).length
        ? cachedMethods
        : await loadProviderAuthMethods(getProviderAuthWorkerType());
      const providerIds = Object.keys(authMethods).sort();
      if (!providerIds.length) {
        throw new Error(t("providers.no_providers_available"));
      }

      const resolved = providerId?.trim() ?? "";
      if (!resolved) {
        throw new Error(t("providers.provider_id_required"));
      }
      assertProviderAllowedByDesktopPolicy(resolved);

      const methods = authMethods[resolved];
      if (!methods || !methods.length) {
        throw new Error(`${t("providers.unknown_provider")}: ${resolved}`);
      }

      const oauthIndex =
        methodIndex !== undefined
          ? methodIndex
          : methods.find((method) => method.type === "oauth")?.methodIndex ?? -1;
      if (oauthIndex === -1) {
        throw new Error(
          `${t("providers.no_oauth_prefix")} ${resolved}. ${t("providers.use_api_key_suffix")}`,
        );
      }

      const selectedMethod = methods.find((method) => method.methodIndex === oauthIndex);
      if (!selectedMethod || selectedMethod.type !== "oauth") {
        throw new Error(`${t("providers.not_oauth_flow_prefix")} ${resolved}.`);
      }

      const auth = await connection.authorizeOAuth(resolved, oauthIndex);
      return { methodIndex: oauthIndex, authorization: auth };
    } catch (error) {
      const message = describeProviderError(error, t("providers.connect_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  const mergeProviderRefreshOptions = (
    current: ProviderRefreshOptions | null,
    next: ProviderRefreshOptions,
  ): ProviderRefreshOptions => ({
    dispose: current?.dispose === true || next.dispose === true,
    force: current?.force === true || next.force === true,
    // A queued refresh may serve several callers. Import unless every queued
    // caller explicitly allows skipping it, so credential reconciliation is
    // never lost behind a lighter catalog-only refresh.
    skipSharedImport: current
      ? current.skipSharedImport === true && next.skipSharedImport === true
      : next.skipSharedImport,
    runtimeEnvironmentChanged:
      current?.runtimeEnvironmentChanged === true || next.runtimeEnvironmentChanged === true,
  });

  const requiresFollowUpProviderRefresh = (value: ProviderRefreshOptions) => (
    value.dispose === true
    || value.force === true
    || value.skipSharedImport === true
    || value.runtimeEnvironmentChanged === true
  );

  async function performProviderRefresh(optionsArg: ProviderRefreshOptions) {
    const accountEnvKeys = await refreshAccountConnectedProviderIds().catch(() => null);
    const client = options.client();
    if (!client) return null;
    const deferSharedImport = Boolean(
      accountEnvKeys
      && options.deferSharedProviderImport?.()
      && !optionsArg?.skipSharedImport
      && !optionsArg?.force
      && !optionsArg?.dispose
      && !optionsArg?.runtimeEnvironmentChanged,
    );
    const sharedProviderImport = optionsArg?.skipSharedImport || !accountEnvKeys || deferSharedImport
      ? { changed: false, requiresReload: false }
      : await importSharedProviderConnections(accountEnvKeys).catch(() => ({
          changed: false,
          requiresReload: false,
        }));
    if (sharedProviderImport.changed) {
      await refreshProviderListQueries(getReactQueryClient());
    }
    if (
      optionsArg?.runtimeEnvironmentChanged
      || (
        (optionsArg?.dispose || sharedProviderImport.requiresReload)
        && getProviderEngineAdapter().capabilities.authChangesRequireReload
      )
    ) {
      const runtimeRestarted = await reloadProviderEngine(client, {
        runtimeEnvironmentChanged: optionsArg?.runtimeEnvironmentChanged,
      });
      if (runtimeRestarted) {
        await refreshProviderListQueries(getReactQueryClient());
        return null;
      }
    }

    const activeClient = options.client() ?? client;
    const activeConnection = getProviderEngineAdapter().connect(activeClient);
    let disabledProviders = options.disabledProviders() ?? [];
    try {
      disabledProviders = await activeConnection.readDisabledProviders();
      options.setDisabledProviders(disabledProviders);
      refreshSnapshot();
      emitChange();
    } catch {
      // ignore config read failures and continue with current store state
    }

    try {
      const updated = filterProviderList(
        await ensureProviderListQuery(getReactQueryClient(), {
          client: activeClient,
          engineId: getProviderEngineAdapter().id,
          baseUrl: options.providerBaseUrl(),
          directory: options.selectedWorkspaceRoot(),
          force: Boolean(optionsArg?.force || optionsArg?.dispose || sharedProviderImport.changed),
        }),
        disabledProviders,
      );
      applyProviderListState(updated);
      if (state.providerAuthError?.includes(t("providers.not_connected"))) {
        // A provider client can be temporarily unavailable while a workspace
        // runtime reconnects. Once the catalog succeeds, remove only that
        // recovered connection error; credential and OAuth failures remain.
        setStateField("providerAuthError", null);
      }
      if (deferSharedImport && accountEnvKeys) {
        // The account provider list is the settings-page source of truth. Show
        // it immediately, then reconcile credentials into the OpenCode runtime
        // without holding the first render behind config writes and reloads.
        void importSharedProviderConnections(accountEnvKeys)
          .then(async (result) => {
            if (!result.changed) return;
            await refreshProviderListQueries(getReactQueryClient());
            await refreshProviders({
              force: true,
              skipSharedImport: true,
            });
          })
          .catch(() => null);
      }
      return updated;
    } catch {
      return null;
    }
  }

  function refreshProviders(
    optionsArg: ProviderRefreshOptions = {},
  ): Promise<ProviderListResponse | null> {
    if (providerRefreshInFlight) {
      if (!requiresFollowUpProviderRefresh(optionsArg)) return providerRefreshInFlight;
      queuedProviderRefreshOptions = mergeProviderRefreshOptions(
        queuedProviderRefreshOptions,
        optionsArg,
      );
      if (!queuedProviderRefresh) {
        queuedProviderRefresh = providerRefreshInFlight
          .catch(() => null)
          .then(() => {
            const queuedOptions = queuedProviderRefreshOptions ?? {};
            queuedProviderRefreshOptions = null;
            queuedProviderRefresh = null;
            return refreshProviders(queuedOptions);
          });
      }
      return queuedProviderRefresh;
    }

    const request = performProviderRefresh(optionsArg);
    providerRefreshInFlight = request;
    const clearInFlight = () => {
      if (providerRefreshInFlight === request) providerRefreshInFlight = null;
    };
    void request.then(clearInFlight, clearInFlight);
    return request;
  }

  async function completeProviderAuthOAuth(
    providerId: string,
    methodIndex: number,
    code?: string,
  ) {
    setStateField("providerAuthError", null);
    const connection = getProviderEngineConnection();

    const resolved = providerId?.trim();
    if (!resolved) {
      throw new Error(t("providers.provider_id_required"));
    }
    assertProviderAllowedByDesktopPolicy(resolved);

    if (!Number.isInteger(methodIndex) || methodIndex < 0) {
      throw new Error(t("providers.oauth_method_required"));
    }

    const waitForProviderConnection = async (timeoutMs = 15000, pollMs = 2000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        try {
          const updated = await refreshProviders({ dispose: true });
          const connected = new Set(updated?.connected ?? []);
          if (connected.has(resolved)) {
            return true;
          }
        } catch {
          // ignore and retry
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return false;
    };

    const isPendingOauthError = (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error ?? "");
      return /request timed out/i.test(text) || /ProviderAuthOauthMissing/i.test(text);
    };

    const finishConnectedOAuth = async () => {
      await mirrorSharedProviderProfile(catalogSharedProviderProfile(options.providers(), resolved));
      setProvidersExplicitlyDisconnected([resolved], false);
      return { connected: true, message: `${t("status.connected")} ${resolved}` };
    };

    try {
      const trimmedCode = code?.trim();
      await connection.completeOAuth(resolved, methodIndex, trimmedCode || undefined);
      await ensureProjectProviderDisabledState(resolved, false);
      const updated = await refreshProviders({ dispose: true });
      const connectedNow = Array.isArray(updated?.connected) && updated.connected.includes(resolved);
      if (connectedNow) {
        return await finishConnectedOAuth();
      }
      const connected = await waitForProviderConnection();
      if (connected) {
        return await finishConnectedOAuth();
      }
      return { connected: false, pending: true };
    } catch (error) {
      if (isPendingOauthError(error)) {
        await ensureProjectProviderDisabledState(resolved, false);
        const updated = await refreshProviders({ dispose: true });
        if (Array.isArray(updated?.connected) && updated.connected.includes(resolved)) {
          return await finishConnectedOAuth();
        }
        const connected = await waitForProviderConnection();
        if (connected) {
          return await finishConnectedOAuth();
        }
        return { connected: false, pending: true };
      }
      const message = describeProviderError(error, t("providers.oauth_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function submitProviderApiKey(providerId: string, apiKey: string, modelIds?: string[]) {
    mutateState((current) => ({
      ...current,
      providerAuthBusy: true,
      providerAuthError: null,
    }));
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setStateField("providerAuthBusy", false);
      throw new Error(t("providers.api_key_required"));
    }
    assertProviderAllowedByDesktopPolicy(providerId);
    const resolvedProviderId = providerId.trim().toLowerCase();
    const portableProfile = compatibleProviderProfile(resolvedProviderId, modelIds);
    const compatibleProfile = getProviderEngineAdapter().capabilities.customProviders
      ? portableProfile
      : null;
    const sharedProfile = portableProfile
      ? buildSharedProviderProfile({
          providerId: portableProfile.id,
          displayName: portableProfile.name,
          api: portableProfile.api,
          baseURL: portableProfile.baseURL,
          npm: portableProfile.npm,
          models: portableProfile.models,
        })
      : catalogSharedProviderProfile(options.providers(), resolvedProviderId);

    try {
      // Save the account-level credential and model profile first. Engine
      // reloads can remount this store, so persisting it last can leave a
      // provider configured in one workspace but unavailable everywhere else.
      await mirrorSharedProviderConnection(trimmed, sharedProfile);
      if (compatibleProfile) {
        await patchRuntimeProviders(
          getProviderEngineAdapter().buildCompatibleProviderPatch(compatibleProfile),
        );
        if (getProviderEngineAdapter().capabilities.authChangesRequireReload) {
          await reloadProviderEngine(options.client());
        }
      }
      await getProviderEngineConnection().setApiKey(resolvedProviderId, trimmed);
      setProvidersExplicitlyDisconnected([resolvedProviderId], false);
      setStateField(
        "accountConnectedProviderIds",
        [...new Set([...state.accountConnectedProviderIds, resolvedProviderId])].sort(),
      );
      await ensureProjectProviderDisabledState(resolvedProviderId, false);
      await refreshProviders({
        dispose: getProviderEngineAdapter().capabilities.authChangesRequireReload,
        force: true,
        skipSharedImport: true,
      });
      if (compatibleProfile) {
        const syntheticProviderId = compatibleProfile.id;
        const nextConnected = [
          ...options.providerConnectedIds().filter((id) => id !== syntheticProviderId),
          syntheticProviderId,
        ];
        options.setProviderConnectedIds(nextConnected);
        refreshSnapshot();
        emitChange();
      }
      return `${t("status.connected")} ${providerId}`;
    } catch (error) {
      const message = describeProviderError(error, t("providers.save_api_key_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setStateField("providerAuthBusy", false);
    }
  }

  async function connectCloudProviderInternal(
    cloudProviderId: string,
    optionsArg?: { silent?: boolean },
  ) {
    if (!optionsArg?.silent) {
      setStateField("providerAuthError", null);
    }
    const connection = getProviderEngineConnection();

    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    if (!token || !orgId) {
      throw new Error("Sign in to iPolloWork Cloud and choose an organization first.");
    }

    try {
      const den = createDenClient({
        baseUrl: settings.baseUrl,
        token,
      });
      const provider = await den.getOrgLlmProviderConnection(orgId, cloudProviderId);
      assertProviderAllowedByDesktopPolicy(provider.providerId);
      const existingImported = state.importedCloudProviders[cloudProviderId] ?? null;
      const localProviderId = getCloudManagedProviderId(provider);
      const { envEntries, primaryApiKey } = resolveCloudProviderCredentials(provider);
      const env = getCloudProviderEnv(provider.providerConfig);
      if (!primaryApiKey && env.length > 0) {
        throw new Error(`${provider.name} does not have a stored organization credential yet.`);
      }

      await assertCloudProviderImportSafe(provider);

      if (envEntries.length > 0) {
        const ipolloworkClient = getProviderServerSnapshot().ipolloworkServerClient;
        if (!ipolloworkClient) {
          throw new Error(
            `${provider.name} needs environment variables (${envEntries
              .map((entry) => entry.key)
              .join(", ")}) but the iPolloWork server is not available.`,
          );
        }
        await ipolloworkClient.upsertUserEnv(envEntries);
      }
      if (primaryApiKey) {
        await connection.setApiKey(localProviderId, primaryApiKey);
        setProvidersExplicitlyDisconnected([localProviderId], false);
        await mirrorSharedProviderConnection(
          primaryApiKey,
          cloudSharedProviderProfile(provider, localProviderId),
        );
        await mirroriPolloWorkModelsVoiceEnv(provider, primaryApiKey);
      }
      if (existingImported?.providerId && existingImported.providerId !== localProviderId) {
        try {
          await removeProviderAuthCredentials(existingImported.providerId);
        } catch (error) {
          if (!isMissingProviderCredentialError(error)) throw error;
        }
      }
      // Cloud providers are runtime-managed: upsert (and delete a renamed
      // predecessor) via the server's per-key provider merge instead of
      // editing the user's engine config file.
      await patchRuntimeProviders(
        getProviderEngineAdapter().buildCloudProviderPatch(
          provider,
          localProviderId,
          existingImported?.providerId ?? null,
        ),
      );
      const nextImportedProviders = {
        ...state.importedCloudProviders,
        [provider.id]: {
          cloudProviderId: provider.id,
          providerId: localProviderId,
          // Track the provider id as shipped by the server at import time
          // so we can detect local/remote drift later (see dev #1510 "key
          // cloud providers by cloud id"). On first import both match.
          sourceProviderId: provider.providerId,
          name: provider.name,
          source: provider.source,
          updatedAt: provider.updatedAt ?? null,
          modelIds: getProviderModelIds(provider),
          importedAt: Date.now(),
        },
      };
      await persistImportedCloudProviders(nextImportedProviders);

      await ensureProjectProviderDisabledState(localProviderId, false);
      if (existingImported?.providerId && existingImported.providerId !== localProviderId) {
        await ensureProjectProviderDisabledState(existingImported.providerId, false);
      }
      markProviderEngineConfigReloadRequired();
      await refreshProviders({ dispose: true });
      refreshSnapshot();
      emitChange();
      return `${t("status.connected")} ${provider.name}`;
    } catch (error) {
      const message = describeProviderError(error, "Failed to connect organization provider.");
      if (!optionsArg?.silent) {
        setStateField("providerAuthError", message);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function connectCloudProvider(cloudProviderId: string) {
    return await connectCloudProviderInternal(cloudProviderId);
  }

  async function removeCloudProviderInternal(
    cloudProviderId: string,
    optionsArg?: { silent?: boolean },
  ) {
    if (!optionsArg?.silent) {
      setStateField("providerAuthError", null);
    }
    const imported = state.importedCloudProviders[cloudProviderId];
    if (!imported) {
      throw new Error("This cloud provider has not been imported into the workspace.");
    }

    try {
      try {
        await removeProviderAuthCredentials(imported.providerId);
      } catch (error) {
        if (!isMissingProviderCredentialError(error)) throw error;
      }
      // Runtime-managed providers have one owner; `null` deletes that entry.
      await patchRuntimeProviders({ [imported.providerId]: null });

      const nextImportedProviders = { ...state.importedCloudProviders };
      delete nextImportedProviders[cloudProviderId];
      await persistImportedCloudProviders(nextImportedProviders);

      options.setDisabledProviders(
        options.disabledProviders().filter((id) => id !== imported.providerId),
      );
      markProviderEngineConfigReloadRequired();
      refreshSnapshot();
      emitChange();
      return `${t("providers.disconnected_prefix")} ${imported.name}`;
    } catch (error) {
      const message = describeProviderError(error, t("providers.disconnect_failed"));
      if (!optionsArg?.silent) {
        setStateField("providerAuthError", message);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function removeCloudProvider(cloudProviderId: string) {
    return await removeCloudProviderInternal(cloudProviderId);
  }

  const logCloudProviderSyncError = (reason: CloudProviderSyncReason, error: unknown) => {
    const message = describeProviderError(error, "Cloud provider sync failed.");
    console.warn(`[cloud-provider-sync:${reason}] ${message}`);
    return message;
  };

  const getCloudProviderSyncContextKey = () => {
    const settings = readDenSettings();
    return [
      settings.baseUrl,
      settings.activeOrgId?.trim() ?? "",
      settings.authToken?.trim() ?? "",
      options.selectedWorkspaceDisplay().workspaceType,
      options.selectedWorkspaceRoot().trim(),
      options.runtimeWorkspaceId() ?? "",
      options.client() ? "connected" : "disconnected",
    ].join("::");
  };

  const hasCloudProviderSyncPrerequisites = () => {
    if (!getProviderEngineAdapter().capabilities.cloudProviderImports) return false;
    if (options.allowCloudImports?.() === false) return false;
    const settings = readDenSettings();
    const workspaceTarget =
      options.selectedWorkspaceRoot().trim() || options.runtimeWorkspaceId() || "";
    return Boolean(
      options.client() &&
        settings.authToken?.trim() &&
        settings.activeOrgId?.trim() &&
        workspaceTarget,
    );
  };

  async function performCloudProviderSync(reason: CloudProviderSyncReason) {
    if (!hasCloudProviderSyncPrerequisites()) {
      return;
    }

    // Imports, baseline reads, and persistence all go through the iPolloWork
    // server target (patchRuntimeProviders throws without it). Running before
    // the target resolves made the baseline read fall back to an empty source
    // and re-import every org provider — engine dispose churn on settings open.
    const target = await resolveiPolloWorkConfigTarget("write");
    if (!target.canUseiPolloWorkServer || !target.ipolloworkClient || !target.ipolloworkWorkspaceId) {
      return;
    }

    let importedProviders: Record<string, CloudImportedProvider>;
    try {
      importedProviders = await refreshImportedCloudProviders({ strict: true });
    } catch (error) {
      logCloudProviderSyncError(reason, error);
      return;
    }
    const liveProviders = await refreshCloudOrgProviders({ force: true });
    const liveProviderMap = new Map(liveProviders.map((provider) => [provider.id, provider]));
    const failures: string[] = [];
    const processedLiveProviderIds = new Set<string>();
    let configChanged = false;

    for (const importedProvider of Object.values(importedProviders)) {
      const liveProvider = liveProviderMap.get(importedProvider.cloudProviderId);
      if (!liveProvider) {
        try {
          await removeCloudProviderInternal(importedProvider.cloudProviderId, { silent: true });
          configChanged = true;
        } catch (error) {
          failures.push(logCloudProviderSyncError(reason, error));
        }
        continue;
      }

      processedLiveProviderIds.add(liveProvider.id);

      if (!isCloudProviderOutOfSync(liveProvider, importedProvider)) {
        continue;
      }

      try {
        // Reconcile in place with a single idempotent rewrite. Re-importing
        // via connectCloudProviderInternal fetches the fresh Den model list
        // and fully replaces the `lpr_*` provider block (added/changed/removed
        // models) while keeping the import baseline. The previous
        // remove-then-reconnect dance could leave the block deleted if the
        // reconnect aborted on a stale in-memory connected-providers guard,
        // so the workspace kept the first-import snapshot forever (#2346).
        await connectCloudProviderInternal(liveProvider.id, { silent: true });
        configChanged = true;
      } catch (error) {
        failures.push(logCloudProviderSyncError(reason, error));
      }
    }

    const nextImportedProviders = state.importedCloudProviders;
    const newlyImported: Array<{ id: string; name: string; providerId: string; firstModelId?: string; firstModelName?: string }> = [];
    for (const liveProvider of liveProviders) {
      if (processedLiveProviderIds.has(liveProvider.id)) {
        continue;
      }
      if (nextImportedProviders[liveProvider.id]) {
        continue;
      }

      try {
        await connectCloudProviderInternal(liveProvider.id, { silent: true });
        configChanged = true;
        const firstModel = liveProvider.models[0] ?? null;
        newlyImported.push({
          id: liveProvider.id,
          name: liveProvider.name,
          providerId: liveProvider.providerId,
          firstModelId: firstModel?.id,
          firstModelName: firstModel?.name ?? firstModel?.id,
        });
      } catch (error) {
        failures.push(logCloudProviderSyncError(reason, error));
      }
    }

    if (configChanged) {
      await refreshProviders({ dispose: true }).catch(() => null);
    }

    // Notify the UI about newly imported providers so the global toast
    // can be shown regardless of which route is active.
    if (newlyImported.length > 0) {
      dispatchNewProviders({
        providers: newlyImported,
        source: reason === "sign_in" ? "sign_in" : "cloud_sync",
      });
    }

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }
  }

  async function runCloudProviderSync(reason: CloudProviderSyncReason) {
    if (cloudProviderSyncInFlight) {
      cloudProviderSyncQueuedReason = reason;
      return cloudProviderSyncInFlight;
    }

    const request = performCloudProviderSync(reason)
      .catch((error) => {
        const message = logCloudProviderSyncError(reason, error);
        if (reason === "settings_cloud_opened") {
          setStateField("providerAuthError", message);
        }
      })
      .finally(() => {
        cloudProviderSyncInFlight = null;
        const queuedReason = cloudProviderSyncQueuedReason;
        cloudProviderSyncQueuedReason = null;
        if (queuedReason) {
          void runCloudProviderSync(queuedReason);
        }
      });

    cloudProviderSyncInFlight = request;
    return request;
  }

  async function disconnectProvider(providerId: string) {
    setStateField("providerAuthError", null);
    getProviderEngineConnection();

    const resolved = providerId.trim().toLowerCase();
    if (!resolved) {
      throw new Error(t("providers.provider_id_required"));
    }

    const trackedImport = Object.values(state.importedCloudProviders).find(
      (entry) => entry.providerId === resolved,
    );
    if (trackedImport) {
      return await removeCloudProvider(trackedImport.cloudProviderId);
    }

    try {
      const providerIds = accountProviderCredentialIds(resolved);
      let runtimeManagedProviderIds: string[] = [];
      try {
        const target = await resolveProviderEngineConfigTarget("write");
        const runtimeProviderIds = new Set(
          (await getProviderEngineAdapter().runtimeProviderIds(target))
            .map((runtimeProviderId) => runtimeProviderId.trim().toLowerCase()),
        );
        runtimeManagedProviderIds = providerIds.filter((id) => runtimeProviderIds.has(id));
      } catch {
        // Credential removal still works when runtime config inspection is unavailable.
      }
      if (runtimeManagedProviderIds.length) {
        await patchRuntimeProviders(Object.fromEntries(
          runtimeManagedProviderIds.map((runtimeProviderId) => [runtimeProviderId, null]),
        ));
      }
      await removeProviderAuthCredentials(resolved);
      // React option getters can still expose the previous connected-provider
      // list until the next render. Keep this successful disconnect
      // authoritative so a stale runtime catalog cannot immediately re-add it.
      setProvidersExplicitlyDisconnected(providerIds, true);
      const environmentBackedProviderId = options.providers().find((provider) => (
        providerIds.includes(provider.id.trim().toLowerCase()) && provider.source === "env"
      ))?.id;
      // Environment-owned providers cannot be removed from their external
      // source. Keep only that legacy case disabled; account API keys and OAuth
      // connections are removed immediately and do not require a manual reload.
      if (environmentBackedProviderId) {
        await ensureProjectProviderDisabledState(environmentBackedProviderId, true);
      }
      await refreshProviders({
        dispose: true,
        force: true,
        skipSharedImport: true,
      });
      removeProviderFromState(providerIds);
      return `${t("providers.disconnected_prefix")} ${resolved}`;
    } catch (error) {
      const message = describeProviderError(error, t("providers.disconnect_failed"));
      setStateField("providerAuthError", message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function openProviderAuthModal(optionsArg?: {
    returnFocusTarget?: ProviderReturnFocusTarget;
    preferredProviderId?: string;
  }) {
    mutateState((current) => ({
      ...current,
      providerAuthReturnFocusTarget: optionsArg?.returnFocusTarget ?? "none",
      providerAuthPreferredProviderId: optionsArg?.preferredProviderId?.trim() || null,
      providerAuthBusy: true,
      providerAuthError: null,
    }));

    try {
      const methods = await loadProviderAuthMethods(getProviderAuthWorkerType());
      mutateState((current) => ({
        ...current,
        providerAuthMethods: methods,
        providerAuthModalOpen: true,
      }));
    } catch (error) {
      const message = describeProviderError(error, t("providers.load_failed"));
      mutateState((current) => ({
        ...current,
        providerAuthPreferredProviderId: null,
        providerAuthReturnFocusTarget: "none",
        providerAuthError: message,
      }));
      throw error;
    } finally {
      setStateField("providerAuthBusy", false);
    }
  }

  function closeProviderAuthModal(optionsArg?: { restorePromptFocus?: boolean }) {
    const shouldFocusPrompt =
      optionsArg?.restorePromptFocus ?? state.providerAuthReturnFocusTarget === "composer";
    mutateState((current) => ({
      ...current,
      providerAuthModalOpen: false,
      providerAuthError: null,
      providerAuthPreferredProviderId: null,
      providerAuthReturnFocusTarget: "none",
    }));
    if (shouldFocusPrompt) {
      options.focusPromptSoon?.();
    }
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const currentWorkspaceKey = () =>
    `${options.selectedWorkspaceRoot().trim()}::${options.runtimeWorkspaceId() ?? ""}`;

  const syncFromOptions = () => {
    const workspaceKey = currentWorkspaceKey();
    const workspaceChanged = workspaceKey !== lastWorkspaceKey;
    lastWorkspaceKey = workspaceKey;
    refreshSnapshot();
    emitChange();
    if (workspaceChanged) {
      void refreshImportedCloudProviders();
      void refreshProviders().catch(() => null);
    }
    if (!hasCloudProviderSyncPrerequisites()) {
      cloudProviderSyncContextKey = "";
      return;
    }

    const nextSyncContextKey = getCloudProviderSyncContextKey();
    if (nextSyncContextKey === cloudProviderSyncContextKey) {
      return;
    }

    cloudProviderSyncContextKey = nextSyncContextKey;
    void runCloudProviderSync("app_launch");
  };

  const start = () => {
    if (started) return;
    // StrictMode double-mount re-arms after dispose.
    disposed = false;
    started = true;
    lastWorkspaceKey = currentWorkspaceKey();
    if (typeof window !== "undefined") {
      const handleDenSessionUpdate = (event: Event) => {
        cloudOrgProvidersLoadKey = "";
        cloudOrgProvidersInFlightKey = "";
        cloudOrgProvidersInFlight = null;
        const detail = (event as CustomEvent<DenSessionUpdatedDetail>).detail;

        if (detail?.status === "success") {
          mutateState((current) => ({
            ...current,
            cloudOrgProviders: [],
            providerAuthMethods: {},
          }));
          void runCloudProviderSync("sign_in");
        } else {
          // Sign-out or error: remove all cloud-imported providers from the workspace
          // Capture the full import records BEFORE clearing state
          const importedProviders = { ...state.importedCloudProviders };
          const importedIds = Object.keys(importedProviders);

          // Best-effort cleanup: remove each cloud provider from project config
          // BEFORE clearing state so removeCloudProviderInternal can find the records
          void (async () => {
            for (const cloudId of importedIds) {
              try {
                await removeCloudProviderInternal(cloudId, { silent: true });
              } catch {
                // Ignore individual removal failures during sign-out cleanup
              }
            }
            // Final sweep removes runtime entries left by an interrupted cleanup.
            try {
              const orphans = await sweepOrphanCloudProvidersFromRuntime();
              for (const providerId of orphans) {
                try {
                  await removeProviderAuthCredentials(providerId);
                } catch {
                  // Ignore auth removal failures for orphans
                }
              }
              if (orphans.length > 0) {
                markProviderEngineConfigReloadRequired();
              }
            } catch {
              // Ignore sweep failures during sign-out cleanup
            }
            // Clear state AFTER cleanup so the records are available during removal
            mutateState((current) => ({
              ...current,
              cloudOrgProviders: [],
              providerAuthMethods: {},
              importedCloudProviders: {},
            }));
            refreshSnapshot();
            emitChange();
          })();
        }
      };
      window.addEventListener(
        denSessionUpdatedEvent,
        handleDenSessionUpdate as EventListener,
      );
      denSessionCleanup = () => {
        window.removeEventListener(
          denSessionUpdatedEvent,
          handleDenSessionUpdate as EventListener,
        );
      };
    }
    void refreshImportedCloudProviders().then((imported) => {
      // Startup cleanup: if no auth token, remove any cloud providers that
      // were left behind. Handles orphans from a previous sign-out that
      // didn't clean up (e.g. crash, force-quit, external edit).
      if (!hasCloudProviderSyncPrerequisites()) {
        void (async () => {
          // First: remove anything tracked in import state
          if (imported && Object.keys(imported).length > 0) {
            for (const cloudId of Object.keys(imported)) {
              try {
                await removeCloudProviderInternal(cloudId, { silent: true });
              } catch {}
            }
          }
          // Then sweep any untracked runtime-owned `lpr_*` keys.
          try {
            const orphans = await sweepOrphanCloudProvidersFromRuntime();
            for (const providerId of orphans) {
              try {
                await removeProviderAuthCredentials(providerId);
              } catch {}
            }
            if (orphans.length > 0) {
              markProviderEngineConfigReloadRequired();
            }
          } catch {}
          mutateState((current) => ({
            ...current,
            importedCloudProviders: {},
          }));
          refreshSnapshot();
          emitChange();
        })();
      }
    });
    void refreshProviders().catch(() => null);
    refreshSnapshot();
    emitChange();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    denSessionCleanup?.();
    denSessionCleanup = null;
    listeners.clear();
  };

  refreshSnapshot();

  return {
    subscribe,
    getSnapshot: () => snapshot,
    start,
    dispose,
    syncFromOptions,
    refreshCloudOrgProviders,
    refreshImportedCloudProviders,
    runCloudProviderSync,
    startProviderAuth,
    refreshProviders,
    completeProviderAuthOAuth,
    submitProviderApiKey,
    connectCloudProvider,
    removeCloudProvider,
    disconnectProvider,
    ensureProjectProviderDisabledState,
    openProviderAuthModal,
    closeProviderAuthModal,
  };
}

export function useProviderAuthStoreSnapshot(store: ProviderAuthStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
