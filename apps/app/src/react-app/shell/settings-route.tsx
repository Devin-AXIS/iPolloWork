/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";

import {
  getMcpServerName,
  MCP_QUICK_CONNECT,
  SUGGESTED_PLUGINS,
} from "@/app/constants";
import {
  canonicalWorkspacesForWorkContext,
  PERSONAL_WORK_CONTEXT_ID,
  pruneServerWorkspacesForWorkContext,
  readActiveWorkContextId,
  workContextChangedEvent,
} from "@/app/lib/work-context";
import type { EnablementContext } from "@/app/enablement";
import { createClient } from "@/app/lib/opencode";
import {
  createiPolloWorkServerClient,
  isLoopbackiPolloWorkServerUrl,
  readiPolloWorkServerSettings,
  iPolloWorkServerError,
  type iPolloWorkServerCapabilities,
  type iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { buildiPolloWorkEnvRuntimeKey } from "@/app/lib/ipollowork-env-runtime";
import {
  getInitialThemeMode,
  setThemeMode as setAppThemeMode,
  type ThemeMode,
} from "@/app/theme";
import type {
  Client,
  ProviderListItem,
  SettingsTab,
  WorkspaceDisplay,
} from "@/app/types";
import { currentLocale, t, setLocale, type Language } from "@/i18n";
import { useModelPicker } from "@/react-app/domains/session/modals/use-model-picker";
import {
  type RouteWorkspace,
  type RouteSession,
  describeRouteError,
  getSessionStatus,
  isActiveSessionStatus,
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
} from "@/react-app/shell/route-workspaces";
import { createConnectionsStore, useConnectionsStoreSnapshot } from "@/react-app/domains/connections/store";
import { useOrgMcpConnections } from "@/react-app/domains/connections/use-org-mcp-connections";
import { createiPolloWorkServerStore, useiPolloWorkServerStoreSnapshot } from "@/react-app/domains/connections/ipollowork-server-store";
import { createProviderAuthStore, useProviderAuthStoreSnapshot } from "@/react-app/domains/connections/provider-auth/store";
import { formatProviderAuthName } from "@/react-app/domains/connections/provider-auth/provider-auth-curation";
import ProviderAuthModal from "@/react-app/domains/connections/provider-auth/provider-auth-modal";
import ConnectionsModals from "@/react-app/domains/connections/modals";
import { AiSettingsView } from "@/react-app/domains/settings/pages/ai-view";
// Side-effect imports: register extension config components into the registry.
import "@/react-app/domains/settings/openai-image-gen-config";
import "@/react-app/domains/settings/ollama-config";
import "@/react-app/domains/settings/minimax-config";
import "@/react-app/domains/settings/computer-use-config";
import "@/react-app/domains/settings/browser-extension-config";
import "@/react-app/domains/settings/ipollowork-voice-config";
import "@/react-app/domains/settings/google-workspace-config";
import { useSettingsExtensionController } from "@/react-app/domains/settings/settings-extension-controller";
import { buildExtensionItems } from "@/react-app/domains/settings/extension-items";
import { isiPolloWorkExtensionEnabled, IPOLLOWORK_EXTENSION_STATE_CHANGED } from "@/react-app/domains/settings/extension-state";
import { PreferencesView } from "@/react-app/domains/settings/pages/preferences-view";
import { ShellCustomizationView } from "@/react-app/domains/settings/pages/shell-view";
import { GeneralSettingsView } from "@/react-app/domains/settings/pages/general-view";
import { AuthorizedFoldersPanel } from "@/react-app/domains/settings/panels/authorized-folders-panel";
import { SettingsStack } from "@/react-app/domains/settings/settings-section";
import { AdvancedView } from "@/react-app/domains/settings/pages/advanced-view";
import { AppearanceView } from "@/react-app/domains/settings/pages/appearance-view";
import { CloudAccountView } from "@/react-app/domains/settings/pages/cloud-account-view";
import { ConnectView } from "@/react-app/domains/settings/pages/connect-view";
import { CloudMarketplacesView } from "@/react-app/domains/settings/pages/cloud-marketplaces-view";
import { CloudProvidersView } from "@/react-app/domains/settings/pages/cloud-providers-view";
import { MemoryView } from "@/react-app/domains/settings/pages/memory-view";
import { useFeatureFlagsPreferences } from "@/react-app/domains/settings/state/feature-flags-preferences";
import { DebugView } from "@/react-app/domains/settings/pages/debug-view";
import { EnvironmentView } from "@/react-app/domains/settings/pages/environment-view";
import { AuthorizationCenterView } from "@/react-app/domains/settings/pages/authorization-center-view";
import { ExtensionsView } from "@/react-app/domains/settings/pages/extensions-view";
import { PluginPackagesPanel } from "@/react-app/domains/settings/plugin-packages-panel";
import type { PluginPackageRelationships } from "@/react-app/domains/settings/plugin-platform-state";
import { RecoveryView } from "@/react-app/domains/settings/pages/recovery-view";
import { SkillsView } from "@/react-app/domains/settings/pages/skills-view";
import { UpdatesView } from "@/react-app/domains/settings/pages/updates-view";
import { useDebugViewModel } from "@/react-app/domains/settings/state/debug-view-model";
import { useElectronUpdaterState } from "@/react-app/domains/settings/state/electron-updater-state";
import { CloudSessionProvider, useCloudSession } from "@/react-app/domains/settings/cloud/cloud-session-provider";
import { useDenSession } from "@/react-app/domains/settings/cloud/use-den-session";
import { useControlAction, type iPolloWorkControlAction } from "./control/control-provider";
import { useBootState } from "./boot-state";
import { SettingsShell } from "@/react-app/domains/settings/shell/settings-shell";
import { createExtensionsStore, useExtensionsStoreSnapshot } from "@/react-app/domains/settings/state/extensions-store";
import { usePlatform } from "@/react-app/kernel/platform";
import { useLocal } from "@/react-app/kernel/local-provider";
import {
  ipolloworkServerRestart,
  engineStart,
  engineRestart,
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  desktopBridge,
  type WorkspaceList,
} from "@/app/lib/desktop";
import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useRestrictionNotice } from "@/react-app/domains/cloud/restriction-notice-provider";
import { useCloudProviderAutoSync } from "@/react-app/domains/cloud/use-cloud-provider-auto-sync";
import {
  hasiPolloWorkModelsProvider,
  hideiPolloWorkModelsPromo,
  isiPolloWorkModelsPromoHidden,
  iPolloWorkModelsPromoChangedEvent,
} from "@/react-app/domains/cloud/ipollowork-models-promo";
import {
  isDesktopRuntime,
  isMacPlatform,
  normalizeDirectoryPath,
} from "@/app/utils";
import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal";
import type { ModelRef } from "@/app/types";
import { recordInspectorEvent } from "../../app/lib/app-inspector";
import { ensureDesktopLocaliPolloWorkConnection } from "./desktop-local-ipollowork";
import { resolveiPolloWorkConnection } from "./ipollowork-connection";
import { abortSessionSafe } from "@/app/lib/opencode-session";
import { notifyAlert } from "./notifications";
import { useReloadCoordinator } from "./reload-coordinator";
import { buildFeedbackUrl } from "@/app/lib/feedback";
import { getDenInferenceUrl } from "@/app/lib/den";
import { readActiveWorkspaceId, writeActiveWorkspaceId } from "./session-memory";
import { workspaceSessionRoute, workspaceSettingsRoute } from "./workspace-routes";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { refreshProviderListQueries } from "@/react-app/infra/provider-list-query";
import {
  OPENAI_IMAGE_EXTENSION_ID,
  OPENAI_IMAGE_MODEL,
} from "@/react-app/domains/settings/openai-image-extension";
import type { LocalProviderInstallInput } from "@/react-app/domains/settings/openai-image-extension";

const ROUTE_IPOLLOWORK_CAPABILITIES: iPolloWorkServerCapabilities = {
  skills: { read: true, write: true, source: "ipollowork" },
  plugins: { read: true, write: true },
  mcp: { read: true, write: true },
  commands: { read: true, write: true },
  config: { read: true, write: true },
};

async function reloadEngineOrRestartDesktop(
  client: Pick<iPolloWorkServerClient, "reloadEngine">,
  workspaceId: string,
  afterRestart?: () => Promise<void>,
): Promise<void> {
  try {
    await client.reloadEngine(workspaceId);
  } catch (error) {
    const unreachable =
      error instanceof iPolloWorkServerError && error.code === "opencode_engine_unreachable";
    if (!unreachable || !isDesktopRuntime()) {
      throw error;
    }
    await engineRestart({});
    await afterRestart?.();
  }
}

function isiPolloWorkCloudProvider(provider: {
  providerId?: string | null;
  source?: string | null;
  sourceProviderId?: string | null;
}) {
  return [provider.providerId, provider.source, provider.sourceProviderId].some(
    (value) => value?.trim().toLowerCase() === "ipollowork",
  );
}

function normalizeComputerUsePermissions(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  return {
    accessibility: "accessibility" in value && value.accessibility === true,
    screenRecording: "screenRecording" in value && value.screenRecording === true,
  };
}

function reconcileSelectedWorkspaceId(
  currentId: string,
  serverList: { activeId?: string | null },
  desktopList: WorkspaceList | null,
  workspaces: RouteWorkspace[],
) {
  const current = currentId.trim();
  const serverIds = new Set(workspaces.map((workspace) => workspace.id));
  if (current && serverIds.has(current)) return current;

  const desktopSelectedId = resolveWorkspaceListSelectedId(desktopList);
  const desktopSelected = desktopSelectedId
    ? desktopList?.workspaces?.find((workspace) => workspace.id === desktopSelectedId)
    : null;
  const currentDesktop = current
    ? desktopList?.workspaces?.find((workspace) => workspace.id === current)
    : null;
  const selectedPath = normalizeDirectoryPath((currentDesktop ?? desktopSelected)?.path ?? "");

  if (selectedPath) {
    const pathMatch = workspaces.find(
      (workspace) => normalizeDirectoryPath(workspace.path ?? "") === selectedPath,
    );
    if (pathMatch) return pathMatch.id;
  }

  return serverList.activeId?.trim() || desktopSelectedId || workspaces[0]?.id || "";
}

const SETTINGS_HIDE_TITLEBAR_KEY = "ipollowork.react.settings.hide-titlebar";
const SETTINGS_UPDATE_AUTO_CHECK_KEY = "ipollowork.react.settings.update-auto-check";
const SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY = "ipollowork.react.settings.update-auto-download";

export function parseSettingsPath(pathname: string): {
  tab: SettingsTab;
  redirectPath: string | null;
  extensionsSection?: "all" | "mcp" | "plugins";
  pluginPackageId?: string;
} {
  const trimmed = pathname
    .replace(/^\/workspace\/[^/]+\/settings\/?/, "")
    .replace(/^\/settings\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return { tab: "preferences", redirectPath: "preferences" };
  }

  const [head, tail, detailId] = trimmed.split("/");
  switch (head) {
    case "general":
    case "ai":
    case "preferences":
    case "permissions":
    case "shell":
    case "advanced":
    case "appearance":
    case "authorizations":
    case "environment":
    case "updates":
    case "recovery":
    case "debug":
      return { tab: head, redirectPath: null };
    case "cloud-account":
    case "connect":
    case "cloud-marketplaces":
    case "cloud-providers":
    case "memory":
      return { tab: head, redirectPath: null };
    case "den":
    case "cloud-workers":
      return { tab: "cloud-account", redirectPath: "cloud-account" };
    case "extensions":
      if (tail === "plugin" && detailId) {
        return {
          tab: "extensions",
          redirectPath: null,
          extensionsSection: "all",
          pluginPackageId: decodeURIComponent(detailId),
        };
      }
      if (tail === "mcp") return { tab: "extensions", redirectPath: null, extensionsSection: "mcp" };
      if (tail === "skills") return { tab: "extensions", redirectPath: null, extensionsSection: "all" };
      if (tail === "plugins") return { tab: "extensions", redirectPath: null, extensionsSection: "plugins" };
      return { tab: "extensions", redirectPath: null, extensionsSection: "all" };
    default:
      return { tab: "preferences", redirectPath: "preferences" };
  }
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore persistence failures
  }
}

function readNavigationWorkspaceId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { workspaceId?: unknown }).workspaceId;
  return typeof value === "string" ? value.trim() || null : null;
}

function readNavigationSessionId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value.trim() || null : null;
}

function findSessionWorkspaceId(
  sessionId: string | null,
  entries: Array<{ workspaceId: string; sessions: any[] }>,
) {
  const id = sessionId?.trim();
  if (!id) return null;
  return entries.find((entry) => entry.sessions.some((session) => session?.id === id))?.workspaceId ?? null;
}

function settingsPathForRoute(route: ReturnType<typeof parseSettingsPath>) {
  if (route.tab === "extensions" && route.pluginPackageId) {
    return `extensions/plugin/${encodeURIComponent(route.pluginPackageId)}`;
  }
  if (route.tab === "extensions" && route.extensionsSection && route.extensionsSection !== "all") {
    return `extensions/${route.extensionsSection}`;
  }
  return route.tab;
}

export type SettingsSurfaceProps = {
  embedded?: boolean;
  initialPath?: string;
  workspaceId?: string;
  onClose?: () => void;
};

function SettingsRouteContent(props: SettingsSurfaceProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ workspaceId?: string }>();
  const routeWorkspaceId = props.workspaceId?.trim() || params.workspaceId?.trim() || "";
  const local = useLocal();
  const { memoryEnabled, toggleMemory } = useFeatureFlagsPreferences();
  const platform = usePlatform();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const restrictionNotice = useRestrictionNotice();
  const reloadCoordinator = useReloadCoordinator();
  const [embeddedPath, setEmbeddedPath] = useState(props.initialPath ?? "preferences");
  const route = props.embedded ? parseSettingsPath(`/settings/${embeddedPath}`) : parseSettingsPath(location.pathname);
  const navigationWorkspaceId = readNavigationWorkspaceId(location.state);
  const navigationSessionId = readNavigationSessionId(location.state);

  const [loading, setLoading] = useState(true);
  const [activeWorkContextId, setActiveWorkContextId] = useState(() => readActiveWorkContextId());
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<Record<string, RouteSession[]>>({});
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] = useState(() => navigationWorkspaceId ?? readActiveWorkspaceId() ?? "");
  const selectedWorkspaceId = routeWorkspaceId || legacySelectedWorkspaceId;

  useEffect(() => {
    if (!props.embedded || !route.redirectPath) return;
    setEmbeddedPath(route.redirectPath);
  }, [props.embedded, route.redirectPath]);

  const navigateSettingsPath = useCallback((path: string) => {
    if (props.embedded) {
      setEmbeddedPath(path);
      return;
    }
    navigate(selectedWorkspaceId ? workspaceSettingsRoute(selectedWorkspaceId, path) : `/settings/${path}`);
  }, [navigate, props.embedded, selectedWorkspaceId]);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [ipolloworkClient, setiPolloWorkClient] = useState<iPolloWorkServerClient | null>(null);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const workspacesRef = useRef<RouteWorkspace[]>([]);
  const refreshInFlightRef = useRef(false);
  const workContextRef = useRef(activeWorkContextId);
  const reconnectAttemptedWorkspaceIdRef = useRef("");
  const refreshMcpServersRef = useRef<(() => void | Promise<void>) | null>(null);
  const notifyMcpReloadingRef = useRef<(() => void) | null>(null);
  const pollMcpServersAfterReloadRef = useRef<(() => void | Promise<void>) | null>(null);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, string>>({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>([]);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [developerMode, setDeveloperMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("ipollowork.developerMode") === "1";
  });
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getInitialThemeMode);
  const [hideTitlebar, setHideTitlebar] = useState(() => readStoredBoolean(SETTINGS_HIDE_TITLEBAR_KEY, false));
  const [updateAutoCheck, setUpdateAutoCheck] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, true),
  );
  const [updateAutoDownload, setUpdateAutoDownload] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, false),
  );
  const [configActionStatus, setConfigActionStatus] = useState<string | null>(null);
  const [autoCompactContext, setAutoCompactContext] = useState(true);
  const [autoCompactContextBusy, setAutoCompactContextBusy] = useState(false);
  const [, setAutoCompactContextLoaded] = useState(false);
  const [localProviderBusy, setLocalProviderBusy] = useState(false);
  const [localProviderStatus, setLocalProviderStatus] = useState<string | null>(null);
  const [localProviderError, setLocalProviderError] = useState<string | null>(null);
  const [googleWorkspaceConnected, setGoogleWorkspaceConnected] = useState(false);
  const [imageExtensionBusy, setImageExtensionBusy] = useState(false);
  const [imageExtensionStatus, setImageExtensionStatus] = useState<string | null>(null);
  const [imageExtensionError, setImageExtensionError] = useState<string | null>(null);
  const [computerUsePermissions, setComputerUsePermissions] = useState<{ accessibility: boolean; screenRecording: boolean } | null>(null);
  const [extensionStateVersion, setExtensionStateVersion] = useState(0);
  const [pluginPackageRelationships, setPluginPackageRelationships] = useState<PluginPackageRelationships>({
    skillNames: [],
    mcpServerNames: [],
  });
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  const [imageGenerationStatus, setImageGenerationStatus] = useState<string | null>(null);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [userEnvKeys, setUserEnvKeys] = useState<string[]>([]);
  const emptyWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () => ({
      id: "",
      name: t("session.workspace_fallback"),
      path: "",
      preset: "starter",
      workspaceType: "local",
    }),
    [],
  );

  const routeStateRef = useRef({
    activeClient: null as Client | null,
    selectedWorkspaceId: "",
    selectedWorkspaceRoot: "",
    selectedWorkspaceType: "local" as "local" | "remote",
    runtimeWorkspaceId: null as string | null,
    ipolloworkServerClient: null as iPolloWorkServerClient | null,
    ipolloworkServerStatus: "disconnected" as "connected" | "disconnected",
    ipolloworkServerCapabilities: null as iPolloWorkServerCapabilities | null,
    selectedWorkspaceDisplay: emptyWorkspaceDisplay as WorkspaceDisplay,
    providerItems: [] as ProviderListItem[],
    providerDefaults: {} as Record<string, string>,
    providerConnectedIds: [] as string[],
    disabledProviders: [] as string[],
    developerMode: false,
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? (selectedWorkspaceId ? null : workspaces[0] ?? null),
    [selectedWorkspaceId, workspaces],
  );
  const selectedWorkspaceRoot = selectedWorkspace?.path?.trim() || "";
  const selectedWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () =>
      selectedWorkspace
        ? {
            id: selectedWorkspace.id,
            name: selectedWorkspace.name ?? selectedWorkspace.displayNameResolved,
            path: selectedWorkspace.path ?? "",
            preset: "starter",
            workspaceType: selectedWorkspace.workspaceType ?? "local",
            displayName: selectedWorkspace.displayNameResolved,
            ipolloworkWorkspaceName: selectedWorkspace.ipolloworkWorkspaceName,
          }
        : emptyWorkspaceDisplay,
    [emptyWorkspaceDisplay, selectedWorkspace],
  );

  routeStateRef.current = {
    activeClient,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspaceType: selectedWorkspace?.workspaceType ?? "local",
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
    ipolloworkServerClient: ipolloworkClient,
    ipolloworkServerStatus: ipolloworkClient ? "connected" : "disconnected",
    ipolloworkServerCapabilities: ipolloworkClient ? ROUTE_IPOLLOWORK_CAPABILITIES : null,
    selectedWorkspaceDisplay,
    providerItems: providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviders,
    developerMode,
  };

  const activeReloadBlockingSessions = useMemo(
    () =>
      Object.values(sessionsByWorkspaceId)
        .flat()
        .flatMap((session) => {
          if (!isActiveSessionStatus(getSessionStatus(session))) return [];
          const id = String(session?.id ?? "");
          if (!id) return [];
          return [{
            id,
            title:
              String(session?.title ?? session?.slug ?? session?.id ?? "").trim() ||
              t("session.untitled"),
          }];
        }),
    [sessionsByWorkspaceId],
  );

  const ipolloworkServerStore = useMemo(
    () =>
      createiPolloWorkServerStore({
        startupPreference: () => {
          // In desktop mode, loopback URLs are ephemeral local runtime details.
          // Only non-loopback stored URLs indicate an explicit remote/manual
          // server connection preference.
          if (!isDesktopRuntime()) return "server";
          const stored = readiPolloWorkServerSettings();
          const storedUrl = stored.urlOverride?.trim() ?? "";
          return storedUrl && !isLoopbackiPolloWorkServerUrl(storedUrl) ? "server" : "local";
        },
        documentVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
        developerMode: () => routeStateRef.current.developerMode,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        activeClient: () => routeStateRef.current.activeClient,
        selectedWorkspaceDisplay: () => routeStateRef.current.selectedWorkspaceDisplay,
        restartLocalServer: async () => {
          if (!isDesktopRuntime()) return false;
          try {
            await ipolloworkServerRestart({
              remoteAccessEnabled:
                readiPolloWorkServerSettings().remoteAccessEnabled === true,
            });
            return true;
          } catch {
            return false;
          }
        },
        createRemoteWorkspaceFlow: async () => false,
      }),
    [],
  );
  const connectionsStore = useMemo(
    () =>
      createConnectionsStore({
        client: () => routeStateRef.current.activeClient,
        setClient: setActiveClient,
        projectDir: () => routeStateRef.current.selectedWorkspaceRoot,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        workspaceType: () => routeStateRef.current.selectedWorkspaceType,
        ipolloworkServer: ipolloworkServerStore,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        ensureRuntimeWorkspaceId: async () =>
          routeStateRef.current.runtimeWorkspaceId?.trim() ||
          routeStateRef.current.selectedWorkspaceId.trim() ||
          null,
        developerMode: () => routeStateRef.current.developerMode,
        markReloadRequired: reloadCoordinator.markReloadRequired,
      }),
    [ipolloworkServerStore, reloadCoordinator.markReloadRequired],
  );
  refreshMcpServersRef.current = connectionsStore.refreshMcpServers;
  notifyMcpReloadingRef.current = connectionsStore.notifyMcpReloading;
  pollMcpServersAfterReloadRef.current = connectionsStore.pollMcpServersAfterReload;
  const providerAuthStore = useMemo(
    () =>
      createProviderAuthStore({
        client: () => routeStateRef.current.activeClient,
        providers: () => routeStateRef.current.providerItems,
        providerDefaults: () => routeStateRef.current.providerDefaults,
        providerConnectedIds: () => routeStateRef.current.providerConnectedIds,
        disabledProviders: () => routeStateRef.current.disabledProviders,
        checkDesktopAppRestriction: checkDesktopRestriction,
        selectedWorkspaceDisplay: () => routeStateRef.current.selectedWorkspaceDisplay,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        allowCloudImports: () => readActiveWorkContextId() === PERSONAL_WORK_CONTEXT_ID,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        ensureRuntimeWorkspaceId: async () =>
          routeStateRef.current.runtimeWorkspaceId?.trim() ||
          routeStateRef.current.selectedWorkspaceId.trim() ||
          null,
        ipolloworkServer: ipolloworkServerStore,
        setProviders,
        setProviderDefaults,
        setProviderConnectedIds,
        setDisabledProviders,
        markOpencodeConfigReloadRequired: () => {
          setConfigActionStatus(t("settings.config_updated"));
          reloadCoordinator.markReloadRequired("config", {
            type: "config",
            name: "opencode.json",
            action: "updated",
          });
        },
      }),
    [checkDesktopRestriction, ipolloworkServerStore, reloadCoordinator.markReloadRequired],
  );
  const extensionsStore = useMemo(
    () =>
      createExtensionsStore({
        client: () => routeStateRef.current.activeClient,
        projectDir: () => routeStateRef.current.selectedWorkspaceRoot,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        workspaceType: () => routeStateRef.current.selectedWorkspaceType,
        allowGlobalExtensions: () => readActiveWorkContextId() === PERSONAL_WORK_CONTEXT_ID,
        ipolloworkServer: ipolloworkServerStore,
        ipolloworkServerConnection: () => ({
          ipolloworkServerClient: routeStateRef.current.ipolloworkServerClient,
          ipolloworkServerStatus: routeStateRef.current.ipolloworkServerStatus,
          ipolloworkServerCapabilities: routeStateRef.current.ipolloworkServerCapabilities,
        }),
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        ensureRuntimeWorkspaceId: async () =>
          routeStateRef.current.runtimeWorkspaceId?.trim() ||
          routeStateRef.current.selectedWorkspaceId.trim() ||
          null,
        setBusy,
        setBusyLabel,
        setBusyStartedAt: () => {},
        setError: (message) => {
          if (message) {
            toast.error(message);
          }
        },
        markReloadRequired: reloadCoordinator.markReloadRequired,
      }),
    [ipolloworkServerStore, reloadCoordinator.markReloadRequired],
  );
  const ipolloworkServerSnapshot = useiPolloWorkServerStoreSnapshot(ipolloworkServerStore);
  const connectionsSnapshot = useConnectionsStoreSnapshot(connectionsStore);
  const providerAuthSnapshot = useProviderAuthStoreSnapshot(providerAuthStore);
  useExtensionsStoreSnapshot(extensionsStore);
  const orgMcpConnections = useOrgMcpConnections();

  const ipolloworkServerStatusForMcp = ipolloworkServerSnapshot.ipolloworkServerStatus;
  useEffect(() => {
    if (ipolloworkServerStatusForMcp !== "connected") return;
    // The first MCP read races the ipollowork-server store's initial health
    // check (a fresh store always starts "disconnected"), so it falls back
    // to config files where server-runtime (config.remote) entries — notably
    // the cloud control MCP — don't exist. Without this re-read the built-in
    // cards show "Tap to connect" until the next full remount even though
    // the entries are configured and healthy.
    void connectionsStore.refreshMcpServers();
  }, [connectionsStore, ipolloworkServerStatusForMcp]);

  const denSession = useDenSession({
    developerMode,
    openLink: (url) => platform.openLink(url),
  });
  const cloudSession = useCloudSession();

  const hasiPolloWorkCloudProvider = useMemo(
    () =>
      providerAuthSnapshot.cloudOrgProviders.some(isiPolloWorkCloudProvider) ||
      Object.values(providerAuthSnapshot.importedCloudProviders ?? {}).some(isiPolloWorkCloudProvider),
    [providerAuthSnapshot.cloudOrgProviders, providerAuthSnapshot.importedCloudProviders],
  );
  const [iPolloWorkModelsPromoHidden, setiPolloWorkModelsPromoHidden] = useState(isiPolloWorkModelsPromoHidden);
  const iPolloWorkModelsConnected =
    (cloudSession.isSignedIn && hasiPolloWorkCloudProvider) ||
    hasiPolloWorkModelsProvider(providerConnectedIds);
  const showiPolloWorkModelsSubscribe = !iPolloWorkModelsConnected && !iPolloWorkModelsPromoHidden;
  const showiPolloWorkModelsConnect = !iPolloWorkModelsConnected && iPolloWorkModelsPromoHidden;

  useEffect(() => {
    const handlePromoChanged = () => setiPolloWorkModelsPromoHidden(isiPolloWorkModelsPromoHidden());
    window.addEventListener(iPolloWorkModelsPromoChangedEvent, handlePromoChanged);
    return () => window.removeEventListener(iPolloWorkModelsPromoChangedEvent, handlePromoChanged);
  }, []);

  const dismissiPolloWorkModelsPromo = useCallback(() => {
    hideiPolloWorkModelsPromo();
    setiPolloWorkModelsPromoHidden(true);
  }, []);

  const subscribeToiPolloWorkModels = useCallback(() => {
    providerAuthStore.closeProviderAuthModal();
    const accountPath = selectedWorkspaceId
      ? workspaceSettingsRoute(selectedWorkspaceId, "cloud-account")
      : "/settings/cloud-account";
    navigate(accountPath);
    window.setTimeout(() => {
      platform.openLink(getDenInferenceUrl(cloudSession.baseUrl));
    }, 0);
  }, [cloudSession.baseUrl, navigate, platform, providerAuthStore, selectedWorkspaceId]);

  const handleOpenProviderAuth = useCallback(() => {
    if (checkDesktopRestriction({ restriction: "allowCustomProviders" })) {
      restrictionNotice.show({
        title: "Adding custom providers is disabled",
        message: "Your organization administrator has disabled adding custom providers.",
      });
      return;
    }

    void providerAuthStore.openProviderAuthModal();
  }, [checkDesktopRestriction, providerAuthStore, restrictionNotice]);

  useEffect(() => {
    if (!activeClient || !selectedWorkspaceId) return;

    void providerAuthStore
      .ensureProjectProviderDisabledState(
        "opencode",
        checkDesktopRestriction({ restriction: "allowZenModel" }),
      )
      .catch((error) => {
        console.warn("[desktop-app-restrictions] failed to sync Zen restriction", error);
      });
  }, [activeClient, checkDesktopRestriction, disabledProviders, providerAuthStore, selectedWorkspaceId, selectedWorkspaceRoot]);

  const debugViewProps = useDebugViewModel({
    developerMode,
    ipolloworkServerStore,
    ipolloworkServerSnapshot,
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
    selectedWorkspaceRoot,
    setRouteError: (message) => {
      if (message) {
        toast.error(message);
      }
    },
  });
  const electronUpdaterState = useElectronUpdaterState({
    updateAutoCheck,
    updateAutoDownload,
    setError: (message) => {
      if (message) {
        // Auto-checks can fail without any user action; alert + log to the
        // notification center instead of a bare toast.
        notifyAlert({
          kind: "update",
          title: t("notifications.updater_error"),
          body: message,
          dedupeKey: "updater-error",
        });
      }
    },
  });

  const selectedWorkspaceEndpoint = useMemo(
    () => resolveWorkspaceEndpoint(selectedWorkspace, { baseUrl, token }),
    [baseUrl, selectedWorkspace, token],
  );
  const opencodeBaseUrl = selectedWorkspaceEndpoint?.opencodeBaseUrl ?? "";
  const runtimeWorkspaceId = selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspace?.id ?? null;
  routeStateRef.current.runtimeWorkspaceId = runtimeWorkspaceId;

  const opencodeClient = useMemo(() => {
    if (!selectedWorkspaceEndpoint || !selectedWorkspaceEndpoint.token) return null;
    return createClient(
      selectedWorkspaceEndpoint.opencodeBaseUrl,
      selectedWorkspaceRoot || undefined,
      {
        token: selectedWorkspaceEndpoint.token,
        mode: "ipollowork",
      },
    );
  }, [selectedWorkspaceEndpoint, selectedWorkspaceRoot]);

  useEffect(() => {
    setActiveClient(opencodeClient);
  }, [opencodeClient]);

  const handleModelPickerLoadError = useCallback((error: unknown) => {
    toast.error(error instanceof Error ? error.message : t("app.unknown_error"));
  }, []);
  const modelPicker = useModelPicker({
    client: opencodeClient,
    baseUrl: opencodeBaseUrl,
    workspaceRoot: selectedWorkspaceRoot,
    onLoadError: handleModelPickerLoadError,
  });
  // Settings refreshes provider auth whenever the picker opens (the session
  // route does not need this; its provider state is kept fresh elsewhere).
  useEffect(() => {
    if (!modelPicker.open) return;
    void providerAuthStore.refreshProviders();
  }, [modelPicker.open, providerAuthStore]);

  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(IPOLLOWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(IPOLLOWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime() || !isMacPlatform()) return;
    let cancelled = false;
    void desktopBridge.checkComputerUsePermissions()
      .then((result) => {
        if (cancelled) return;
        const permissions = normalizeComputerUsePermissions(result);
        if (permissions) setComputerUsePermissions(permissions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const client = selectedWorkspaceEndpoint?.client ?? ipolloworkClient;
    if (!client) {
      setGoogleWorkspaceConnected(false);
      return;
    }

    let cancelled = false;
    void client.googleWorkspaceStatus()
      .then((result) => {
        if (!cancelled) setGoogleWorkspaceConnected(result.connected === true);
      })
      .catch(() => {
        if (!cancelled) setGoogleWorkspaceConnected(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ipolloworkClient, selectedWorkspaceEndpoint]);

  useEffect(() => {
    if (!ipolloworkClient) {
      setUserEnvKeys([]);
      return;
    }
    let cancelled = false;
    void ipolloworkClient.listUserEnvKeys()
      .then((response) => { if (!cancelled) setUserEnvKeys(response.keys); })
      .catch(() => { if (!cancelled) setUserEnvKeys([]); });
    return () => { cancelled = true; };
  }, [ipolloworkClient]);

  const installOpenAiImageExtension = useCallback(async (apiKey: string) => {
    const resolvedApiKey = apiKey.trim();
    if (!ipolloworkClient) {
      setImageExtensionError("iPolloWork server is not connected.");
      return;
    }
    if (!resolvedApiKey) {
      setImageExtensionError("OpenAI API key is required.");
      return;
    }

    setImageExtensionBusy(true);
    setImageExtensionStatus(null);
    setImageExtensionError(null);
    try {
      await ipolloworkClient.upsertUserEnv([{ key: "OPENAI_API_KEY", value: resolvedApiKey }]);
      setUserEnvKeys((current) => Array.from(new Set([...current, "OPENAI_API_KEY"])));
      setImageExtensionStatus("Saved OPENAI_API_KEY. Agents can use iPolloWork extension actions for image generation.");
    } catch (error) {
      setImageExtensionError(describeRouteError(error));
    } finally {
      setImageExtensionBusy(false);
    }
  }, [ipolloworkClient]);

  const generateOpenAiTestImage = useCallback(async (input: { apiKey: string; prompt: string }) => {
    const client = selectedWorkspaceEndpoint?.client ?? ipolloworkClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const apiKey = input.apiKey.trim();
    const prompt = input.prompt.trim();
    if (!client || !workspaceId) {
      setImageGenerationError("iPolloWork server is not connected for this workspace.");
      return;
    }
    if (!apiKey) {
      setImageGenerationError("OpenAI API key is required.");
      return;
    }
    if (!prompt) {
      setImageGenerationError("Prompt is required.");
      return;
    }

    setImageGenerationBusy(true);
    setImageGenerationStatus(null);
    setImageGenerationError(null);
    try {
      if (ipolloworkClient) {
        await ipolloworkClient.upsertUserEnv([{ key: "OPENAI_API_KEY", value: apiKey }]);
        setUserEnvKeys((current) => Array.from(new Set([...current, "OPENAI_API_KEY"])));
      }
      const response = await client.callExtensionAction({
        extensionId: OPENAI_IMAGE_EXTENSION_ID,
        action: "image_generate",
        args: { prompt },
        context: { directory: selectedWorkspaceRoot || undefined },
      });
      if (!response.ok) {
        setImageGenerationError(response.message);
        return;
      }
      const result = response.result;
      const path = typeof result === "object" && result !== null && "path" in result && typeof result.path === "string"
        ? result.path
        : "an artifact";
      setImageGenerationStatus(`Generated ${path} with ${OPENAI_IMAGE_MODEL}.`);
    } catch (error) {
      setImageGenerationError(describeRouteError(error));
    } finally {
      setImageGenerationBusy(false);
    }
  }, [ipolloworkClient, runtimeWorkspaceId, selectedWorkspaceEndpoint, selectedWorkspaceRoot]);

  const saveVoiceApiKey = useCallback(async (apiKey: string) => {
    const resolvedApiKey = apiKey.trim();
    if (!ipolloworkClient || !resolvedApiKey) {
      setVoiceError("OpenAI API key is required.");
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus(null);
    setVoiceError(null);
    try {
      await ipolloworkClient.upsertUserEnv([{ key: "OPENAI_API_KEY", value: resolvedApiKey }]);
      setUserEnvKeys((current) => Array.from(new Set([...current, "OPENAI_API_KEY"])));
      setVoiceStatus("Saved OPENAI_API_KEY for Voice Mode.");
    } catch (error) {
      setVoiceError(describeRouteError(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [ipolloworkClient]);

  const testVoiceSession = useCallback(async () => {
    if (!ipolloworkClient) {
      setVoiceError("iPolloWork server is not connected.");
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus(null);
    setVoiceError(null);
    try {
      const session = await ipolloworkClient.createVoiceRealtimeSession();
      setVoiceStatus(`Realtime ready with ${session.model} (${session.tools.length} iPolloWork tools).`);
    } catch (error) {
      setVoiceError(describeRouteError(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [ipolloworkClient]);

  const installLocalProvider = useCallback(async (input: LocalProviderInstallInput) => {
    const client = selectedWorkspaceEndpoint?.client ?? ipolloworkClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const modelId = input.modelId.trim();
    const api = input.api?.trim() ?? "";
    const baseURL = input.baseURL?.trim() ?? "";
    const models = input.models ?? {
      [modelId]: { name: input.modelName.trim() || modelId },
    };
    if (!client || !workspaceId) {
      setLocalProviderError("iPolloWork server is not connected for this workspace.");
      return;
    }
    if (!modelId || Object.keys(models).length === 0) {
      setLocalProviderError("Model ID is required.");
      return;
    }
    if (!api && !baseURL) {
      setLocalProviderError("A provider API URL is required.");
      return;
    }

    setLocalProviderBusy(true);
    setLocalProviderStatus(null);
    setLocalProviderError(null);
    try {
      await client.patchConfig(workspaceId, {
        opencode: {
          provider: {
            [input.providerId]: {
              npm: input.npm ?? "@ai-sdk/openai-compatible",
              name: input.name,
              ...(api ? { api } : { options: { baseURL } }),
              models,
            },
          },
        },
      });
      if (input.apiKey?.trim()) {
        if (!opencodeClient) {
          throw new Error("OpenCode is not connected for this workspace.");
        }
        await opencodeClient.auth.set({
          providerID: input.providerId,
          auth: { type: "api", key: input.apiKey.trim() },
        });
      }
      if (input.setDefault) {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: { providerID: input.providerId, modelID: modelId },
          modelVariant: null,
        }));
      }
      reloadCoordinator.markReloadRequired("config", { type: "config", name: "opencode.json", action: "updated" });
      try {
        await reloadEngineOrRestartDesktop(client, workspaceId);
      } catch {
        // The reload toast still lets the user retry if the immediate reload fails.
      }
      await refreshProviderListQueries(getReactQueryClient());
      try {
        window.dispatchEvent(new CustomEvent("ipollowork-server-settings-changed"));
      } catch {
        // ignore browser event dispatch failures
      }
      setLocalProviderStatus(`Added ${input.name} with ${Object.keys(models).length} model${Object.keys(models).length === 1 ? "" : "s"}.`);
    } catch (error) {
      setLocalProviderError(describeRouteError(error));
    } finally {
      setLocalProviderBusy(false);
    }
  }, [local, ipolloworkClient, opencodeClient, reloadCoordinator, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

  useEffect(() => {
    local.setUi((previous) => ({ ...previous, view: "settings", tab: route.tab }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- local is stable via context
  }, [route.tab]);

  useEffect(() => {
    setAppThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_HIDE_TITLEBAR_KEY, hideTitlebar);
  }, [hideTitlebar]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, updateAutoCheck);
  }, [updateAutoCheck]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, updateAutoDownload);
  }, [updateAutoDownload]);

  const { markRouteReady: markBootRouteReady } = useBootState();
  const refreshRouteState = useMemo(() => async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const requestedContextId = activeWorkContextId;
    setLoading(true);
    let desktopList: WorkspaceList | null = null;
    let desktopWorkspaces = workspacesRef.current;
    try {
      if (isDesktopRuntime()) {
        try {
          desktopList = await workspaceBootstrap() as WorkspaceList;
          desktopWorkspaces = canonicalWorkspacesForWorkContext(
            (desktopList.workspaces ?? []).map(mapDesktopWorkspace),
            requestedContextId,
            [resolveWorkspaceListSelectedId(desktopList)],
          );
        } catch (error) {
          const message = describeRouteError(error);
          console.error("[settings-route] workspaceBootstrap failed", error);
          recordInspectorEvent("route.workspace_bootstrap.error", {
            route: "settings",
            message,
            preservedWorkspaceCount: workspacesRef.current.length,
          });
          desktopWorkspaces = workspacesRef.current;
        }
      }
      const { normalizedBaseUrl, resolvedToken, resolvedHostToken } = await resolveiPolloWorkConnection();

      if (!normalizedBaseUrl || !resolvedToken) {
        setiPolloWorkClient(null);
        setBaseUrl("");
        setToken("");
        setWorkspaces(desktopWorkspaces);
        setSessionsByWorkspaceId({});
        setLegacySelectedWorkspaceId((current) => {
          const next = current || readActiveWorkspaceId() || resolveWorkspaceListSelectedId(desktopList) || desktopWorkspaces[0]?.id || "";
          writeActiveWorkspaceId(next || null);
          return next;
        });
        return;
      }

      const client = createiPolloWorkServerClient({
        baseUrl: normalizedBaseUrl,
        token: resolvedToken,
        hostToken: resolvedHostToken || undefined,
      });
      const list = await client.listWorkspaces();
      const serverWorkspaceIds = new Set(list.items.map((workspace) => workspace.id));
      const nextWorkspaces = canonicalWorkspacesForWorkContext(
        mergeRouteWorkspaces(list.items, desktopWorkspaces),
        requestedContextId,
        [
          routeWorkspaceId,
          readActiveWorkspaceId(),
          resolveWorkspaceListSelectedId(desktopList),
          list.activeId,
        ],
      );
      if (workContextRef.current !== requestedContextId) return;
      const canonicalServerWorkspaceId = nextWorkspaces.find((workspace) => serverWorkspaceIds.has(workspace.id))?.id ?? "";
      if (canonicalServerWorkspaceId) {
        void pruneServerWorkspacesForWorkContext(
          client,
          list.items,
          requestedContextId,
          canonicalServerWorkspaceId,
        ).catch((error) => {
          console.warn("[settings-route] failed to prune legacy workspace identities", error);
        });
      }
      const sessionEntries = await Promise.all(
        nextWorkspaces.map(async (workspace) => {
          if (!serverWorkspaceIds.has(workspace.id)) {
            return { workspaceId: workspace.id, sessions: [] };
          }
          try {
            const response = await client.listSessions(workspace.id, { limit: 200 });
            const workspaceRoot = normalizeDirectoryPath(workspace.path ?? "");
            const items = workspaceRoot
              ? (response.items ?? []).filter((session) =>
                  normalizeDirectoryPath(session?.directory ?? "") === workspaceRoot,
                )
              : (response.items ?? []);
            return {
              workspaceId: workspace.id,
              sessions: items,
            };
          } catch {
            return { workspaceId: workspace.id, sessions: [] };
          }
        }),
      );

      setiPolloWorkClient(client);
      setBaseUrl(normalizedBaseUrl);
      setToken(resolvedToken);
      setWorkspaces(nextWorkspaces);
      setSessionsByWorkspaceId(Object.fromEntries(sessionEntries.map((entry) => [entry.workspaceId, entry.sessions])));
      setLegacySelectedWorkspaceId((current) => {
        const sessionWorkspaceId = findSessionWorkspaceId(navigationSessionId, sessionEntries);
        const preferred = routeWorkspaceId || sessionWorkspaceId || navigationWorkspaceId || current || readActiveWorkspaceId() || "";
        const next = reconcileSelectedWorkspaceId(preferred, list, desktopList, nextWorkspaces);
        writeActiveWorkspaceId(next || null);
        return next;
      });
    } catch (error) {
      const message = describeRouteError(error);
      console.error("[settings-route] refreshRouteState failed", error);
      recordInspectorEvent("route.refresh.error", {
        route: "settings",
        message,
        preservedWorkspaceCount: desktopWorkspaces.length,
      });
      // Fires on mount/auto-refresh too, not just user actions.
      notifyAlert({
        kind: "system",
        title: t("notifications.refresh_failed"),
        body: message,
        dedupeKey: "settings-route-refresh",
      });
      if (workContextRef.current === requestedContextId && desktopWorkspaces.length > 0) {
        setWorkspaces(desktopWorkspaces);
        setLegacySelectedWorkspaceId((current) => {
          const next = current || readActiveWorkspaceId() || resolveWorkspaceListSelectedId(desktopList) || desktopWorkspaces[0]?.id || "";
          writeActiveWorkspaceId(next || null);
          return next;
        });
      }
    } finally {
      if (workContextRef.current === requestedContextId) {
        setLoading(false);
      }
      refreshInFlightRef.current = false;
      // Settings can be the first route a user lands on (direct link, deep
      // link, or after reload). Let the boot overlay dismiss once we've
      // completed our first data load.
      markBootRouteReady();
    }
  }, [activeWorkContextId, markBootRouteReady, navigationSessionId, navigationWorkspaceId, routeWorkspaceId]);

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!ipolloworkClient || !workspaceId) {
      toast.error(t("app.error_connect_first"));
      return false;
    }

    await reloadEngineOrRestartDesktop(ipolloworkClient, workspaceId, refreshRouteState);
    await refreshProviderListQueries(getReactQueryClient());

    try {
      window.dispatchEvent(new CustomEvent("ipollowork-server-settings-changed"));
    } catch {
      // ignore browser event dispatch failures
    }

    // OpenCode reconnects MCPs async after dispose — the store polls until
    // statuses settle so users don't have to collapse/expand the card.
    void pollMcpServersAfterReloadRef.current?.();

    return true;
  }, [ipolloworkClient, refreshRouteState, selectedWorkspaceId]);

  useEffect(() => {
    return reloadCoordinator.registerWorkspaceReloadControls({
      canReloadWorkspaceEngine: () => Boolean(ipolloworkClient && (selectedWorkspace?.id || selectedWorkspaceId)),
      reloadWorkspaceEngine: reloadWorkspaceEngineFromUi,
      activeSessions: () => activeReloadBlockingSessions,
      stopSession: async (sessionId) => {
        if (!activeClient) return;
        await abortSessionSafe(activeClient, sessionId);
      },
    });
  }, [
    activeClient,
    activeReloadBlockingSessions,
    ipolloworkClient,
    reloadCoordinator,
    reloadWorkspaceEngineFromUi,
    selectedWorkspace?.id,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (loading) return;
    if (ipolloworkClient) {
      reconnectAttemptedWorkspaceIdRef.current = "";
      return;
    }
    if (!selectedWorkspace || selectedWorkspace.workspaceType !== "local") return;
    const workspaceId = selectedWorkspace.id?.trim() ?? "";
    if (!workspaceId || reconnectAttemptedWorkspaceIdRef.current === workspaceId) return;
    reconnectAttemptedWorkspaceIdRef.current = workspaceId;

    void ensureDesktopLocaliPolloWorkConnection({
      route: "settings",
      workspace: selectedWorkspace,
      allWorkspaces: workspaces,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : describeRouteError(error);
      // Background auto-reconnect: alert + persistent center entry.
      notifyAlert({
        kind: "system",
        title: t("notifications.reconnect_failed"),
        body: message,
        dedupeKey: "server-reconnect",
      });
    });
  }, [loading, ipolloworkClient, selectedWorkspace, workspaces]);

  useEffect(() => {
    const handleWorkContextChanged = () => {
      const nextContextId = readActiveWorkContextId();
      workContextRef.current = nextContextId;
      refreshInFlightRef.current = false;
      workspacesRef.current = [];
      setWorkspaces([]);
      setSessionsByWorkspaceId({});
      setLegacySelectedWorkspaceId("");
      setActiveWorkContextId(nextContextId);
    };
    window.addEventListener(workContextChangedEvent, handleWorkContextChanged);
    return () => window.removeEventListener(workContextChangedEvent, handleWorkContextChanged);
  }, []);

  useEffect(() => {
    void refreshRouteState();
    const handleSettingsChange = () => {
      void refreshRouteState();
    };
    window.addEventListener("ipollowork-server-settings-changed", handleSettingsChange);
    return () => {
      window.removeEventListener("ipollowork-server-settings-changed", handleSettingsChange);
    };
  }, [refreshRouteState]);

  // Load auto-compaction state from OpenCode config on workspace change.
  useEffect(() => {
    if (!ipolloworkClient || !selectedWorkspaceId) return;
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId;
    let cancelled = false;
    (async () => {
      try {
        const config = await ipolloworkClient.getConfig(workspaceId);
        if (cancelled) return;
        const compaction = config.opencode?.compaction;
        const auto = compaction && typeof compaction === "object" && "auto" in compaction
          ? (compaction as { auto?: boolean }).auto
          : undefined;
        setAutoCompactContext(auto !== false);
        setAutoCompactContextLoaded(true);
      } catch {
        if (!cancelled) setAutoCompactContextLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [ipolloworkClient, selectedWorkspaceId]);

  const toggleAutoCompactContext = useCallback(async () => {
    if (autoCompactContextBusy) return;
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId;
    if (!ipolloworkClient || !workspaceId) return;
    const next = !autoCompactContext;
    setAutoCompactContext(next);
    setAutoCompactContextBusy(true);
    try {
      await ipolloworkClient.patchConfig(workspaceId, {
        opencode: { compaction: { auto: next } },
      });
      reloadCoordinator.markReloadRequired("config", {
        type: "config",
        name: "opencode.json",
        action: "updated",
      });
    } catch {
      setAutoCompactContext(!next);
    } finally {
      setAutoCompactContextBusy(false);
    }
  }, [autoCompactContext, autoCompactContextBusy, ipolloworkClient, reloadCoordinator, selectedWorkspaceId]);

  useEffect(() => {
    ipolloworkServerStore.start();
    connectionsStore.start();
    providerAuthStore.start();
    extensionsStore.start();

    return () => {
      extensionsStore.dispose();
      providerAuthStore.dispose();
      connectionsStore.dispose();
      ipolloworkServerStore.dispose();
    };
  }, [connectionsStore, extensionsStore, ipolloworkServerStore, providerAuthStore]);

  const refreshMarketplaceAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "extensions.refresh-marketplace",
    label: "Refresh marketplace extensions",
    description: "Load the latest public plugin packages from iPolloWork Cloud.",
    sideEffect: "none",
    execute: async () => {
      const items = await cloudSession.client.listMarketplacePlugins();
      return { marketplaceCount: items.length };
    },
  }), [cloudSession.client]);
  useControlAction(refreshMarketplaceAction);

  // Periodically reconcile workspace-imported cloud providers from Den while
  // signed in (dev #1509 "auto-sync cloud providers"). Mounted here because
  // the settings route owns the provider-auth store.
  useCloudProviderAutoSync(providerAuthStore.runCloudProviderSync);

  // Keep the Den cloud MCP configured with a fresh first-party token while
  // signed in: connects on sign-in, re-mints on org switch and before expiry.
  useCloudProviderAutoSync(() => connectionsStore.syncCloudControlMcp());

  useEffect(() => {
    if (route.tab !== "cloud-providers") return;
    void providerAuthStore.runCloudProviderSync("settings_cloud_opened");
  }, [providerAuthStore, route.tab]);

  useEffect(() => {
    ipolloworkServerStore.syncFromOptions();
    connectionsStore.syncFromOptions();
    providerAuthStore.syncFromOptions();
    extensionsStore.syncFromOptions();
  }, [
    activeClient,
    connectionsStore,
    extensionsStore,
    ipolloworkServerStore,
    providerAuthStore,
    selectedWorkspace?.id,
    selectedWorkspace?.workspaceType,
    selectedWorkspaceRoot,
  ]);

  useEffect(() => {
    if (!activeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      setDisabledProviders([]);
      return;
    }
    void providerAuthStore.refreshProviders();
    void connectionsStore.refreshMcpServers();
  }, [activeClient, connectionsStore, providerAuthStore, selectedWorkspace?.id]);

  const selectedWorkspaceName = selectedWorkspace?.displayNameResolved ?? t("session.workspace_fallback");
  const workspaceType = selectedWorkspace?.workspaceType ?? "local";
  const isRemoteWorkspace = workspaceType === "remote";
  const canWriteWorkspaceSkills =
    !isRemoteWorkspace || ipolloworkServerSnapshot.ipolloworkServerCanWriteSkills;
  const canWriteWorkspacePlugins =
    !isRemoteWorkspace || ipolloworkServerSnapshot.ipolloworkServerCanWritePlugins;
  const skillsAccessHint =
    isRemoteWorkspace && !canWriteWorkspaceSkills ? t("app.skills_hint_readonly") : null;
  const pluginsAccessHint =
    isRemoteWorkspace && !canWriteWorkspacePlugins ? t("app.plugins_hint_readonly") : null;
  const providerStatusLabel = providerConnectedIds.length > 0 ? t("status.connected") : t("status.disconnected_label");
  const providerStatusStyle = providerConnectedIds.length > 0
    ? "bg-green-7/10 text-green-11 border-green-7/20"
    : "bg-gray-4/60 text-gray-11 border-gray-7/50";
  const providerSummary = providerConnectedIds.length > 0
    ? t("status.providers_connected", { count: providerConnectedIds.length })
    : t("settings.no_providers_connected");
  const providerConnectedIdSet = new Set(providerConnectedIds);
  const connectedProviders = providers.flatMap((provider) =>
    providerConnectedIdSet.has(provider.id)
      ? [{
          id: provider.id,
          name: formatProviderAuthName(provider.id, provider.name),
          displayId: provider.id.trim().toLowerCase() === "opencode" ? "ipollowork" : provider.id,
          source: provider.source,
        }]
      : [],
  );
  const ipolloworkCloudMcpUrl = connectionsSnapshot.mcpServers.find(
    (server) => server.name === "ipollowork-cloud",
  )?.config.url ?? null;

  // Build enablement context from all available runtime state.
  const enablementContext = useMemo<EnablementContext>(() => {
    const mcpConfigured = new Set(connectionsSnapshot.mcpServers.map((s) => s.name));
    const connectedProviders = new Set(providerConnectedIds);
    const configuredEnvKeys = new Set(userEnvKeys);
    const loadedPlugins = new Set<string>();
    // Browser plugin detection: check if any configured plugin matches the chrome-devtools name.
    // For now, treat it as loaded if the plugin is in the MCP/plugin list — this will
    // be refined when we add a real plugin-loaded signal from the engine.
    const browserPluginConfigured = connectionsSnapshot.mcpServers.some(
      (s) => s.name === "opencode-chrome-devtools" || s.config.command?.some((c: string) => c.includes("chrome-devtools")),
    );
    if (browserPluginConfigured) loadedPlugins.add("opencode-chrome-devtools");

    return {
      mcpStatuses: connectionsSnapshot.mcpStatuses,
      mcpConfigured,
      loadedPlugins,
      connectedProviders,
      configuredEnvKeys,
      permissions: computerUsePermissions ?? undefined,
      // Toggle state reader for extensions with defaultEnabled / explicit toggle.
      isToggleEnabled: (ref: string) => {
        const catalog = connectionsStore.quickConnect;
        const match = catalog.find((e: { id?: string; serverName?: string }) => (e.id ?? e.serverName) === ref);
        return match ? isiPolloWorkExtensionEnabled(match) : false;
      },
    };
  }, [computerUsePermissions, connectionsSnapshot, extensionStateVersion, providerConnectedIds, userEnvKeys]);
  const restartExtensionLocalServer = useCallback(async () => {
    if (!isDesktopRuntime()) return false;
    try {
      await ipolloworkServerRestart({
        remoteAccessEnabled:
          readiPolloWorkServerSettings().remoteAccessEnabled === true,
      });
      await ipolloworkServerStore.reconnectiPolloWorkServer();
      await refreshRouteState();
      return true;
    } catch {
      return false;
    }
  }, [ipolloworkServerStore, refreshRouteState]);
  const extensionController = useSettingsExtensionController({
    ipolloworkServerClient: selectedWorkspaceEndpoint?.client ?? ipolloworkClient,
    hostiPolloWorkServerClient: ipolloworkClient,
    enablementContext,
    mcpServers: connectionsSnapshot.mcpServers,
    mcpConnectingName: connectionsSnapshot.mcpConnectingName,
    onComputerUsePermissionsChange: setComputerUsePermissions,
    googleWorkspaceConnected,
    setGoogleWorkspaceConnected,
    restartLocalServer: restartExtensionLocalServer,
    connectMcp: async (entry) => {
      await connectionsStore.connectMcp(entry);
    },
    refreshMcpServers: () => connectionsStore.refreshMcpServers(),
    providers,
    providerConnectedIds,
    userEnvKeys,
    imageExtension: {
      busy: imageExtensionBusy || imageGenerationBusy,
      status: imageExtensionStatus ?? imageGenerationStatus,
      error: imageExtensionError ?? imageGenerationError,
      onInstall: installOpenAiImageExtension,
      onTestGenerate: generateOpenAiTestImage,
    },
    voiceExtension: {
      busy: voiceBusy,
      status: voiceStatus,
      error: voiceError,
      onSaveApiKey: saveVoiceApiKey,
      onTestSession: testVoiceSession,
    },
    localProvider: {
      busy: localProviderBusy,
      status: localProviderStatus,
      error: localProviderError,
      onInstall: installLocalProvider,
    },
  });
  const extensionItems = useMemo(
    () => buildExtensionItems({
      quickConnect: connectionsStore.quickConnect,
      mcpServers: connectionsSnapshot.mcpServers,
      installedSkills: extensionsStore.skills(),
      pluginPackageSkillNames: pluginPackageRelationships.skillNames,
      pluginPackageMcpServerNames: pluginPackageRelationships.mcpServerNames,
      importedCloudPlugins: extensionsStore.importedCloudPlugins(),
      pendingCloudPluginChanges: extensionsStore.pendingCloudPluginChanges(),
      cloudMarketplaces: extensionsStore.cloudOrgMarketplaces(),
      orgMcpConnections: orgMcpConnections.connections,
      enablementContext,
      isBuiltInConnected: extensionController.isConnected,
    }),
    [connectionsSnapshot.mcpServers, connectionsStore.quickConnect, enablementContext, extensionController, extensionsStore, orgMcpConnections.connections, pluginPackageRelationships],
  );
  const routeiPolloWorkStatus = ipolloworkClient ? "connected" : "disconnected";
  const routeiPolloWorkCapabilities: iPolloWorkServerCapabilities | null = ipolloworkClient
    ? ROUTE_IPOLLOWORK_CAPABILITIES
    : null;
  const environmentRuntimeKey = buildiPolloWorkEnvRuntimeKey({
    baseUrl: ipolloworkServerSnapshot.ipolloworkServerBaseUrl || ipolloworkServerSnapshot.ipolloworkServerUrl,
    pid: ipolloworkServerSnapshot.ipolloworkServerHostInfo?.pid ?? null,
    port: ipolloworkServerSnapshot.ipolloworkServerHostInfo?.port ?? null,
  });

  const handleApplyEnvironmentChanges = async () => {
    if (!isDesktopRuntime()) {
      throw new Error(t("settings.environment.apply_unavailable"));
    }
    if (activeReloadBlockingSessions.length > 0) {
      throw new Error(t("settings.environment.apply_blocked_active_tasks"));
    }
    if (!selectedWorkspaceRoot) {
      throw new Error(t("settings.environment.apply_no_local_workspace"));
    }
    const workspacePaths = Array.from(
      new Set(
        workspaces.flatMap((workspace) => {
          const path = workspace.workspaceType !== "remote" ? workspace.path?.trim() ?? "" : "";
          return path ? [path] : [];
        }),
      ),
    );
    const workspacePathSet = new Set(workspacePaths);
    if (!workspacePathSet.has(selectedWorkspaceRoot)) {
      workspacePaths.unshift(selectedWorkspaceRoot);
    }
    await engineStart(selectedWorkspaceRoot, {
      preferSidecar: true,
      runtime: "direct",
      workspacePaths,
      ipolloworkRemoteAccess: ipolloworkServerSnapshot.ipolloworkServerSettings.remoteAccessEnabled === true,
    });
    const reconnected = await ipolloworkServerStore.reconnectiPolloWorkServer();
    if (!reconnected) {
      await refreshRouteState().catch(() => {});
      return { statusMessage: t("settings.environment.apply_refresh_failed") };
    }
    await refreshRouteState();
  };

  // Hooks must run unconditionally: this useCallback used to sit below the
  // redirect returns, so the bare <-> workspace-scoped settings transition
  // changed the hook count and crashed the whole settings surface
  // ("Rendered more/fewer hooks than during the previous render").
  const refreshConnectMarketplaceItems = useCallback(
    () => extensionsStore.refreshCloudOrgMarketplaces({ force: true }),
    [extensionsStore],
  );

  if (route.redirectPath && !props.embedded) {
    const target = selectedWorkspaceId
      ? workspaceSettingsRoute(selectedWorkspaceId, route.redirectPath)
      : `/settings/${route.redirectPath}`;
    return <Navigate to={target} replace state={location.state} />;
  }

  if (!props.embedded && !routeWorkspaceId && selectedWorkspaceId) {
    return <Navigate to={workspaceSettingsRoute(selectedWorkspaceId, settingsPathForRoute(route))} replace state={location.state} />;
  }

  const openCloudAccountSettings = () => {
    navigateSettingsPath("cloud-account");
  };

  const settingsView = (() => {
    switch (route.tab) {
      case "general":
        return (
          <GeneralSettingsView
            onNavigateTab={(tab) => navigateSettingsPath(tab)}
            developerMode={developerMode}
            onSendFeedback={() => platform.openLink(buildFeedbackUrl({ entrypoint: "settings" }))}
            onReportIssue={() => platform.openLink("https://github.com/Devin-AXIS/iPolloWork/issues/new?template=bug.yml")}
          />
        );
      case "permissions":
        return (
          <SettingsStack>
            <AuthorizedFoldersPanel
              ipolloworkServerClient={ipolloworkClient}
              ipolloworkServerStatus={routeiPolloWorkStatus}
              ipolloworkServerCapabilities={routeiPolloWorkCapabilities}
              runtimeWorkspaceId={runtimeWorkspaceId}
              selectedWorkspaceRoot={selectedWorkspaceRoot}
              activeWorkspaceType={workspaceType}
              onConfigUpdated={() => {
                setConfigActionStatus(t("settings.config_updated"));
                void providerAuthStore.refreshProviders();
                void connectionsStore.refreshMcpServers();
              }}
            />
          </SettingsStack>
        );
      case "ai":
        return (
          <AiSettingsView
            busy={busy}
            providerAuthBusy={providerAuthSnapshot.providerAuthBusy}
            providerStatusLabel={providerStatusLabel}
            providerStatusStyle={providerStatusStyle}
            providerSummary={providerSummary}
            connectedProviders={connectedProviders}
            disconnectingProviderId={null}
            providerConnectError={providerAuthSnapshot.providerAuthError}
            providerDisconnectStatus={configActionStatus}
            providerDisconnectError={null}
            onOpenProviderAuth={handleOpenProviderAuth}
            onDisconnectProvider={(providerId) => providerAuthStore.disconnectProvider(providerId)}
            canDisconnectProvider={(source) => source !== "env"}
            cloudProviderIds={new Set(
              Object.values(providerAuthSnapshot.importedCloudProviders ?? {}).map((p) => p.providerId)
            )}
            showiPolloWorkModelsSubscribe={showiPolloWorkModelsSubscribe}
            showiPolloWorkModelsConnect={showiPolloWorkModelsConnect}
            onSubscribeiPolloWorkModels={subscribeToiPolloWorkModels}
            onDismissiPolloWorkModels={dismissiPolloWorkModelsPromo}
            cloudProvidersView={
              <CloudProvidersView
                embedded
                cloudOrgProviders={providerAuthSnapshot.cloudOrgProviders}
                connectCloudProvider={providerAuthStore.connectCloudProvider}
                importedCloudProviders={providerAuthSnapshot.importedCloudProviders}
                onOpenAccount={openCloudAccountSettings}
                refreshCloudOrgProviders={providerAuthStore.refreshCloudOrgProviders}
                refreshImportedCloudProviders={providerAuthStore.refreshImportedCloudProviders}
                removeCloudProvider={providerAuthStore.removeCloudProvider}
                session={denSession}
              />
            }
          />
        );
      case "preferences":
        return (
          <PreferencesView
            busy={busy}
            showThinking={local.prefs.showThinking}
            onToggleShowThinking={() => {
              local.setPrefs((previous) => ({ ...previous, showThinking: !previous.showThinking }));
            }}
            autoCompactContext={autoCompactContext}
            autoCompactContextBusy={autoCompactContextBusy}
            onToggleAutoCompactContext={toggleAutoCompactContext}
            analyticsEnabled={local.prefs.analyticsEnabled}
            onToggleAnalytics={() => {
              local.setPrefs((previous) => ({ ...previous, analyticsEnabled: !previous.analyticsEnabled }));
            }}
            desktopNotifications={local.prefs.desktopNotifications}
            onDesktopNotificationsChange={(desktopNotifications) => {
              local.setPrefs((previous) => ({ ...previous, desktopNotifications }));
            }}
            memoryEnabled={memoryEnabled}
            onToggleMemory={toggleMemory}
          />
        );
      case "shell":
        return <ShellCustomizationView />;
      case "skills":
        return (
          <SkillsView
            workspaceName={selectedWorkspaceName}
            busy={busy}
            canInstallSkillCreator={canWriteWorkspaceSkills}
            canUseDesktopTools={!isRemoteWorkspace}
            accessHint={skillsAccessHint}
            extensions={extensionsStore}
            onOpenLink={(url) => platform.openLink(url)}
            createSessionAndOpen={async (_command?: string): Promise<string | undefined> => {
              props.onClose?.();
              navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId) : "/session");
              return undefined;
            }}
          />
        );
      case "extensions": {
        const skillsView = (
          <SkillsView
            workspaceName={selectedWorkspaceName}
            busy={busy}
            showHeader={false}
            canInstallSkillCreator={canWriteWorkspaceSkills}
            canUseDesktopTools={!isRemoteWorkspace}
            accessHint={skillsAccessHint}
            extensions={extensionsStore}
            onOpenLink={(url) => platform.openLink(url)}
            createSessionAndOpen={async (_command?: string): Promise<string | undefined> => {
              props.onClose?.();
              navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId) : "/session");
              return undefined;
            }}
          />
        );
        const pluginPackagesView = (
          <PluginPackagesPanel
            client={selectedWorkspaceEndpoint?.client ?? ipolloworkClient}
            workspaceId={runtimeWorkspaceId}
            selectedPluginId={route.pluginPackageId ?? null}
            onSelectPlugin={(pluginId) => {
              navigateSettingsPath(pluginId ? `extensions/plugin/${encodeURIComponent(pluginId)}` : "extensions");
            }}
            onOpenUrl={(url) => platform.openLink(url)}
            mcpStatuses={connectionsSnapshot.mcpStatuses}
            onConnectMcp={async (serverName) => {
              const entry = MCP_QUICK_CONNECT.find((candidate) => getMcpServerName(candidate) === serverName);
              if (!entry) return null;
              const configured = await connectionsStore.connectMcp(entry);
              if (!configured) {
                return connectionsStore.mcpStatuses[serverName] ?? {
                  status: "failed" as const,
                  error: connectionsStore.mcpStatus ?? t("mcp.connect_failed"),
                };
              }
              await connectionsStore.refreshMcpServers();
              return connectionsStore.mcpStatuses[serverName] ?? null;
            }}
            onLogoutMcpAuth={(serverName) => {
              void connectionsStore.logoutMcpAuth(serverName);
            }}
            onRelationshipsChange={setPluginPackageRelationships}
            marketplaceView={(search) => (
              <CloudMarketplacesView
                embedded
                search={search}
                client={selectedWorkspaceEndpoint?.client ?? ipolloworkClient}
                workspaceId={runtimeWorkspaceId}
                onOpenAccount={openCloudAccountSettings}
                onInstalled={(pluginId) => navigateSettingsPath(`extensions/plugin/${encodeURIComponent(pluginId)}`)}
              />
            )}
          />
        );
        if (route.pluginPackageId) return pluginPackagesView;
        return (
          <ExtensionsView
            busy={busy}
            selectedWorkspaceRoot={selectedWorkspaceRoot}
            canEditPlugins={canWriteWorkspacePlugins}
            canUseGlobalScope={!isRemoteWorkspace && activeWorkContextId === PERSONAL_WORK_CONTEXT_ID}
            accessHint={pluginsAccessHint}
            suggestedPlugins={SUGGESTED_PLUGINS}
            extensions={extensionsStore}
            client={selectedWorkspaceEndpoint?.client ?? ipolloworkClient}
            workspaceId={runtimeWorkspaceId}
            initialSection={route.extensionsSection}
            setSectionRoute={(section) => {
              const path = `extensions/${section}`;
              navigateSettingsPath(path);
            }}
            pluginPackagesView={pluginPackagesView}
            skillsView={skillsView}
          />
        );
      }
      case "cloud-account":
        return (
          <CloudAccountView
            developerMode={developerMode}
            session={denSession}
          />
        );
      case "connect":
        return (
          <ConnectView
            developerMode={developerMode}
            session={denSession}
            marketplaceItems={extensionItems.cloudPluginItems}
            refreshMarketplaceItems={refreshConnectMarketplaceItems}
          />
        );
      case "cloud-marketplaces":
        return (
          <CloudMarketplacesView
            client={selectedWorkspaceEndpoint?.client ?? ipolloworkClient}
            workspaceId={runtimeWorkspaceId}
            onOpenAccount={openCloudAccountSettings}
            onInstalled={(pluginId) => navigateSettingsPath(`extensions/plugin/${encodeURIComponent(pluginId)}`)}
          />
        );
      case "memory":
        return <MemoryView onOpenAccount={openCloudAccountSettings} />;
      case "cloud-providers":
        return (
          <CloudProvidersView
            cloudOrgProviders={providerAuthSnapshot.cloudOrgProviders}
            connectCloudProvider={providerAuthStore.connectCloudProvider}
            importedCloudProviders={providerAuthSnapshot.importedCloudProviders}
            onOpenAccount={openCloudAccountSettings}
            refreshCloudOrgProviders={providerAuthStore.refreshCloudOrgProviders}
            refreshImportedCloudProviders={providerAuthStore.refreshImportedCloudProviders}
            removeCloudProvider={providerAuthStore.removeCloudProvider}
            session={denSession}
          />
        );
      case "advanced":
        return (
          <AdvancedView
            busy={busy}
            clientConnected={Boolean(opencodeClient)}
            opencodeConnectStatus={null}
            ipolloworkServerStatus={ipolloworkServerSnapshot.ipolloworkServerStatus}
            developerMode={developerMode}
            toggleDeveloperMode={() => setDeveloperMode((current) => {
              const next = !current;
              try { window.localStorage.setItem("ipollowork.developerMode", next ? "1" : "0"); } catch {}
              return next;
            })}
            opencodeDevModeEnabled={false}
            openDebugDeepLink={async () => ({ ok: false, message: "Debug deep links are not wired into the React settings route yet." })}
            cloudMcpUrl={ipolloworkCloudMcpUrl}
            canMigrateRuntimeConfig={Boolean(ipolloworkClient && selectedWorkspaceId)}
            migrateRuntimeConfig={async () => {
              if (!ipolloworkClient || !selectedWorkspaceId) {
                throw new Error("Select a workspace before migrating legacy runtime config.");
              }
              const result = await ipolloworkClient.migrateRuntimeConfig(selectedWorkspaceId);
              if (result.migrated) {
                void connectionsStore.refreshMcpServers();
                void extensionsStore.refreshPlugins();
              }
              return { migrated: result.migrated, keys: result.keys };
            }}
            getRuntimeConfigStatus={async () => {
              if (!ipolloworkClient || !selectedWorkspaceId) {
                throw new Error("Select a workspace to inspect runtime config.");
              }
              return ipolloworkClient.getRuntimeConfigStatus(selectedWorkspaceId);
            }}
            organizationServer={denSession}
          />
        );
      case "appearance":
        return (
          <AppearanceView
            busy={busy}
            themeMode={themeMode}
            setThemeMode={setThemeModeState}
            language={currentLocale() as Language}
            setLanguage={setLocale}
            hideTitlebar={hideTitlebar}
            toggleHideTitlebar={() => setHideTitlebar((current) => !current)}
          />
        );
      case "updates":
        return (
          <UpdatesView
            busy={busy}
            webDeployment={platform.platform === "web"}
            appVersion={electronUpdaterState.appVersion}
            updateEnv={electronUpdaterState.updateEnv}
            updateAutoCheck={updateAutoCheck}
            toggleUpdateAutoCheck={() => setUpdateAutoCheck((current) => !current)}
            updateAutoDownload={updateAutoDownload}
            toggleUpdateAutoDownload={() => setUpdateAutoDownload((current) => !current)}
            updateStatus={electronUpdaterState.updateStatus}
            anyActiveRuns={activeReloadBlockingSessions.length > 0}
            checkForUpdates={electronUpdaterState.checkForUpdates}
            downloadUpdate={electronUpdaterState.downloadUpdate}
            installUpdateAndRestart={electronUpdaterState.installUpdateAndRestart}
          />
        );
      case "recovery":
        return (
          <RecoveryView
            anyActiveRuns={false}
            workspaceConfigPath={selectedWorkspaceRoot ? `${selectedWorkspaceRoot}/.opencode/ipollowork.json` : ""}
            resetConfigBusy={false}
            onResetAppConfigDefaults={() => {}}
            configActionStatus={configActionStatus}
            cacheRepairBusy={false}
            cacheRepairResult={null}
            onRepairOpencodeCache={() => {}}
            dockerCleanupBusy={false}
            dockerCleanupResult={null}
            onCleanupiPolloWorkDockerContainers={() => {}}
          />
        );
      case "environment":
        return (
          <EnvironmentView
            client={ipolloworkServerSnapshot.ipolloworkServerClient}
            isRemoteWorkspace={isRemoteWorkspace}
            onApplyChanges={isDesktopRuntime() && !isRemoteWorkspace ? handleApplyEnvironmentChanges : undefined}
            applyBlocked={activeReloadBlockingSessions.length > 0}
            applyBlockedReason={
              activeReloadBlockingSessions.length > 0
                ? t("settings.environment.apply_blocked_active_tasks")
                : null
            }
            runtimeKey={environmentRuntimeKey}
          />
        );
      case "authorizations":
        return (
          <AuthorizationCenterView
            client={ipolloworkServerSnapshot.ipolloworkServerClient}
            isRemoteWorkspace={isRemoteWorkspace}
            onApplyChanges={isDesktopRuntime() && !isRemoteWorkspace ? handleApplyEnvironmentChanges : undefined}
            applyBlocked={activeReloadBlockingSessions.length > 0}
            applyBlockedReason={
              activeReloadBlockingSessions.length > 0
                ? t("settings.environment.apply_blocked_active_tasks")
                : null
            }
            runtimeKey={environmentRuntimeKey}
          />
        );
      case "debug":
        return <DebugView {...debugViewProps} />;
      default:
        return null;
    }
  })();

  return (
    <>
      <SettingsShell
        activeTab={route.tab}
        onSelectTab={(tab) => navigateSettingsPath(tab)}
        developerMode={developerMode}
        headerStatus={routeiPolloWorkStatus}
        busyHint={loading ? t("session.loading_detail") : busyLabel}
        onClose={props.onClose ?? (() => navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId, navigationSessionId) : "/session"))}
        compact={props.embedded}
        hidePageHeader={Boolean(route.pluginPackageId)}
        hideShellHeader={Boolean(route.pluginPackageId)}
      >
        {settingsView}
      </SettingsShell>

      <ProviderAuthModal
        open={providerAuthSnapshot.providerAuthModalOpen}
        loading={false}
        submitting={providerAuthSnapshot.providerAuthBusy}
        error={providerAuthSnapshot.providerAuthError}
        preferredProviderId={providerAuthSnapshot.providerAuthPreferredProviderId}
        workerType={providerAuthSnapshot.providerAuthWorkerType}
        // Hide any provider the org blocks at the desktop layer so users
        // can't connect a forbidden one (dev #1505). Same helper covers
        // opencode-provider gating via the `allowZenModel` restriction.
        // We also strip the matching key from `authMethods` because the
        // modal builds its entry list from `Object.keys(authMethods)`,
        // not from `providers`.
        providers={providerAuthSnapshot.providerAuthProviders.filter(
          (provider) =>
            !isDesktopProviderBlocked({
              providerId: provider.id,
              checkRestriction: checkDesktopRestriction,
            }),
        )}
        connectedProviderIds={providerConnectedIds}
        authMethods={Object.fromEntries(
          Object.entries(providerAuthSnapshot.providerAuthMethods).filter(
            ([providerId]) =>
              !isDesktopProviderBlocked({
                providerId,
                checkRestriction: checkDesktopRestriction,
              }),
          ),
        )}
        onSelect={providerAuthStore.startProviderAuth}
        onSubmitApiKey={providerAuthStore.submitProviderApiKey}
        onDisconnectProvider={providerAuthStore.disconnectProvider}
        onConnectCloudProvider={providerAuthStore.connectCloudProvider}
        onSubmitOAuth={providerAuthStore.completeProviderAuthOAuth}
        onRefreshProviders={providerAuthStore.refreshProviders}
        showiPolloWorkModelsSubscribe={showiPolloWorkModelsSubscribe}
        onSubscribeiPolloWorkModels={subscribeToiPolloWorkModels}
        onClose={() => providerAuthStore.closeProviderAuthModal()}
      />
      <ConnectionsModals
        client={activeClient}
        projectDir={selectedWorkspaceRoot}
        reloadBlocked={activeReloadBlockingSessions.length > 0}
        activeSessions={activeReloadBlockingSessions}
        isRemoteWorkspace={selectedWorkspace?.workspaceType === "remote"}
        onForceStopSession={async (sessionId) => {
          if (!activeClient) return;
          await abortSessionSafe(activeClient, sessionId);
        }}
        onReloadEngine={reloadCoordinator.reloadWorkspaceEngine}
        modalState={{
          mcpAuthModalOpen: connectionsSnapshot.mcpAuthModalOpen,
          mcpAuthEntry: connectionsSnapshot.mcpAuthEntry,
          mcpAuthNeedsReload: connectionsSnapshot.mcpAuthNeedsReload,
        }}
        onCloseMcpAuthModal={() => connectionsStore.closeMcpAuthModal()}
        onCompleteMcpAuthModal={() => connectionsStore.completeMcpAuthModal()}
      />
      <ModelPickerModal
        open={modelPicker.open}
        options={modelPicker.options}
        query={modelPicker.query}
        setQuery={modelPicker.setQuery}
        target="default"
        current={
          local.prefs.defaultModel ?? { providerID: "", modelID: "" }
        }
        onSelect={(next: ModelRef) => {
          local.setPrefs((prev) => ({
            ...prev,
            defaultModel: next,
            modelVariant: prev.defaultModel?.providerID === next.providerID && prev.defaultModel.modelID === next.modelID
              ? prev.modelVariant
              : null,
          }));
          modelPicker.setOpen(false);
        }}
        onBehaviorChange={() => {}}
        onOpenSettings={() => {}}
        onClose={() => modelPicker.setOpen(false)}
      />
    </>
  );
}

export function SettingsRoute() {
  return <SettingsSurface />;
}

export function SettingsSurface(props: SettingsSurfaceProps) {
  return (
    <CloudSessionProvider>
      <SettingsRouteContent {...props} />
    </CloudSessionProvider>
  );
}
