import { useSyncExternalStore } from "react";

import { t } from "../../../i18n";
import type { StartupPreference, WorkspaceDisplay } from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import {
  ipolloworkServerInfo,
  ipolloworkServerRestart,
  type iPolloWorkServerInfo,
} from "../../../app/lib/desktop";
import {
  cleariPolloWorkServerSettings,
  createiPolloWorkServerClient,
  isLoopbackiPolloWorkServerUrl,
  normalizeiPolloWorkServerUrl,
  readiPolloWorkServerSettings,
  writeiPolloWorkServerSettings,
  type iPolloWorkAuditEntry,
  type iPolloWorkServerCapabilities,
  type iPolloWorkServerClient,
  type iPolloWorkServerDiagnostics,
  type iPolloWorkServerError,
  type iPolloWorkServerSettings,
  type iPolloWorkServerStatus,
} from "../../../app/lib/ipollowork-server";

type SetStateAction<T> = T | ((current: T) => T);

type RemoteWorkspaceInput = {
  ipolloworkHostUrl: string;
  ipolloworkToken?: string | null;
  directory?: string | null;
  displayName?: string | null;
};

export type iPolloWorkServerStoreSnapshot = {
  ipolloworkServerSettings: iPolloWorkServerSettings;
  shareRemoteAccessBusy: boolean;
  shareRemoteAccessError: string | null;
  ipolloworkServerUrl: string;
  ipolloworkServerBaseUrl: string;
  ipolloworkServerAuth: { token?: string; hostToken?: string };
  ipolloworkServerClient: iPolloWorkServerClient | null;
  ipolloworkServerStatus: iPolloWorkServerStatus;
  ipolloworkServerCapabilities: iPolloWorkServerCapabilities | null;
  ipolloworkServerReady: boolean;
  ipolloworkServerWorkspaceReady: boolean;
  resolvediPolloWorkCapabilities: iPolloWorkServerCapabilities | null;
  ipolloworkServerCanWriteSkills: boolean;
  ipolloworkServerCanWritePlugins: boolean;
  ipolloworkServerHostInfo: iPolloWorkServerInfo | null;
  ipolloworkServerDiagnostics: iPolloWorkServerDiagnostics | null;
  ipolloworkReconnectBusy: boolean;
  ipolloworkAuditEntries: iPolloWorkAuditEntry[];
  ipolloworkAuditStatus: "idle" | "loading" | "error";
  ipolloworkAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

export type iPolloWorkServerStore = ReturnType<typeof createiPolloWorkServerStore>;

type CreateiPolloWorkServerStoreOptions = {
  startupPreference: () => StartupPreference | null;
  documentVisible: () => boolean;
  developerMode: () => boolean;
  runtimeWorkspaceId: () => string | null;
  activeClient: () => unknown | null;
  selectedWorkspaceDisplay: () => WorkspaceDisplay;
  restartLocalServer: () => Promise<boolean>;
  createRemoteWorkspaceFlow: (input: RemoteWorkspaceInput) => Promise<boolean>;
};

type MutableState = {
  ipolloworkServerSettings: iPolloWorkServerSettings;
  shareRemoteAccessBusy: boolean;
  shareRemoteAccessError: string | null;
  ipolloworkServerUrl: string;
  ipolloworkServerStatus: iPolloWorkServerStatus;
  ipolloworkServerCapabilities: iPolloWorkServerCapabilities | null;
  ipolloworkServerCheckedAt: number | null;
  ipolloworkServerHostInfo: iPolloWorkServerInfo | null;
  ipolloworkServerHostInfoReady: boolean;
  ipolloworkServerDiagnostics: iPolloWorkServerDiagnostics | null;
  ipolloworkReconnectBusy: boolean;
  ipolloworkAuditEntries: iPolloWorkAuditEntry[];
  ipolloworkAuditStatus: "idle" | "loading" | "error";
  ipolloworkAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
  typeof next === "function" ? (next as (value: T) => T)(current) : next;

export function createiPolloWorkServerStore(options: CreateiPolloWorkServerStoreOptions) {
  const bootStartedAt = Date.now();
  const listeners = new Set<() => void>();
  const intervals = new Map<string, number>();

  let clientCacheKey = "";
  let clientCacheValue: iPolloWorkServerClient | null = null;
  let started = false;
  let disposed = false;
  let healthTimeoutId: number | null = null;
  let healthBusy = false;
  let healthDelayMs = 10_000;
  let consecutiveHealthFailures = 0;
  let visibilityChangeHandler: (() => void) | null = null;
  let snapshot: iPolloWorkServerStoreSnapshot;

  let state: MutableState = {
    ipolloworkServerSettings: readiPolloWorkServerSettings(),
    shareRemoteAccessBusy: false,
    shareRemoteAccessError: null,
    ipolloworkServerUrl: "",
    ipolloworkServerStatus: "disconnected",
    ipolloworkServerCapabilities: null,
    ipolloworkServerCheckedAt: null,
    ipolloworkServerHostInfo: null,
    ipolloworkServerHostInfoReady: !isDesktopRuntime(),
    ipolloworkServerDiagnostics: null,
    ipolloworkReconnectBusy: false,
    ipolloworkAuditEntries: [],
    ipolloworkAuditStatus: "idle",
    ipolloworkAuditError: null,
    devtoolsWorkspaceId: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getBaseUrl = () => {
    const pref = options.startupPreference();
    const hostInfo = state.ipolloworkServerHostInfo;
    const settingsUrl = normalizeiPolloWorkServerUrl(state.ipolloworkServerSettings.urlOverride ?? "") ?? "";

    if (pref === "local") return hostInfo?.baseUrl ?? "";
    if (pref === "server" && settingsUrl && isLoopbackiPolloWorkServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return hostInfo.baseUrl;
    }
    if (pref === "server") return settingsUrl;
    return hostInfo?.baseUrl ?? settingsUrl;
  };

  const getAuth = () => {
    const pref = options.startupPreference();
    const hostInfo = state.ipolloworkServerHostInfo;
    const settingsUrl = normalizeiPolloWorkServerUrl(state.ipolloworkServerSettings.urlOverride ?? "") ?? "";
    const settingsToken = state.ipolloworkServerSettings.token?.trim() ?? "";
    const settingsHostToken = state.ipolloworkServerSettings.hostToken?.trim() ?? "";
    const clientToken = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";

    if (pref === "local") {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    if (pref === "server" && settingsUrl && isLoopbackiPolloWorkServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return {
        token: clientToken || settingsToken || undefined,
        hostToken: hostToken || settingsHostToken || undefined,
      };
    }
    if (pref === "server") {
      return {
        token: settingsToken || undefined,
        hostToken: settingsUrl && isLoopbackiPolloWorkServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
      };
    }
    if (hostInfo?.baseUrl) {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    return {
      token: settingsToken || undefined,
      hostToken: settingsUrl && isLoopbackiPolloWorkServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
    };
  };

  const getClient = () => {
    const baseUrl = getBaseUrl().trim();
    if (!baseUrl) {
      clientCacheKey = "";
      clientCacheValue = null;
      return null;
    }

    const auth = getAuth();
    const key = `${baseUrl}::${auth.token ?? ""}::${auth.hostToken ?? ""}`;
    if (key !== clientCacheKey) {
      clientCacheKey = key;
      clientCacheValue = createiPolloWorkServerClient({
        baseUrl,
        token: auth.token,
        hostToken: auth.hostToken,
      });
    }
    return clientCacheValue;
  };

  const refreshSnapshot = () => {
    const ipolloworkServerBaseUrl = getBaseUrl().trim();
    const ipolloworkServerAuth = getAuth();
    const ipolloworkServerClient = getClient();
    const ipolloworkServerReady = state.ipolloworkServerStatus === "connected";
    const ipolloworkServerWorkspaceReady = Boolean(options.runtimeWorkspaceId());
    const resolvediPolloWorkCapabilities = state.ipolloworkServerCapabilities;

    const pref = options.startupPreference();
    const info = state.ipolloworkServerHostInfo;
    const hostUrl = info?.connectUrl ?? info?.lanUrl ?? info?.mdnsUrl ?? info?.baseUrl ?? "";
    const settingsUrl = normalizeiPolloWorkServerUrl(state.ipolloworkServerSettings.urlOverride ?? "") ?? "";

    let ipolloworkServerUrl = hostUrl || settingsUrl;
    if (pref === "local") ipolloworkServerUrl = hostUrl;
    if (pref === "server") ipolloworkServerUrl = settingsUrl;
    state.ipolloworkServerUrl = ipolloworkServerUrl;

    snapshot = {
      ipolloworkServerSettings: state.ipolloworkServerSettings,
      shareRemoteAccessBusy: state.shareRemoteAccessBusy,
      shareRemoteAccessError: state.shareRemoteAccessError,
      ipolloworkServerUrl,
      ipolloworkServerBaseUrl,
      ipolloworkServerAuth,
      ipolloworkServerClient,
      ipolloworkServerStatus: state.ipolloworkServerStatus,
      ipolloworkServerCapabilities: state.ipolloworkServerCapabilities,
      ipolloworkServerReady,
      ipolloworkServerWorkspaceReady,
      resolvediPolloWorkCapabilities,
      ipolloworkServerCanWriteSkills:
        ipolloworkServerReady &&
        (resolvediPolloWorkCapabilities?.skills?.write ?? false),
      ipolloworkServerCanWritePlugins:
        ipolloworkServerReady &&
        (resolvediPolloWorkCapabilities?.plugins?.write ?? false),
      ipolloworkServerHostInfo: state.ipolloworkServerHostInfo,
      ipolloworkServerDiagnostics: state.ipolloworkServerDiagnostics,
      ipolloworkReconnectBusy: state.ipolloworkReconnectBusy,
      ipolloworkAuditEntries: state.ipolloworkAuditEntries,
      ipolloworkAuditStatus: state.ipolloworkAuditStatus,
      ipolloworkAuditError: state.ipolloworkAuditError,
      devtoolsWorkspaceId: state.devtoolsWorkspaceId,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const setiPolloWorkServerSettings = (next: SetStateAction<iPolloWorkServerSettings>) => {
    const resolved = applyStateAction(state.ipolloworkServerSettings, next);
    mutateState((current) => ({ ...current, ipolloworkServerSettings: resolved }));
    queueHealthCheck(0);
  };

  const updateiPolloWorkServerSettings = (next: iPolloWorkServerSettings) => {
    const stored = writeiPolloWorkServerSettings(next);
    mutateState((current) => ({ ...current, ipolloworkServerSettings: stored }));
    queueHealthCheck(0);
  };

  const resetiPolloWorkServerSettings = () => {
    cleariPolloWorkServerSettings();
    mutateState((current) => ({ ...current, ipolloworkServerSettings: {} }));
    queueHealthCheck(0);
  };

  const shouldWaitForLocalHostInfo = () =>
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    !state.ipolloworkServerHostInfoReady;

  const shouldRetryStartupCheck = (status: iPolloWorkServerStatus) =>
    status !== "connected" &&
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    Date.now() - bootStartedAt < 5_000;

  const checkiPolloWorkServer = async (url: string, token?: string, hostToken?: string) => {
    const client = createiPolloWorkServerClient({ baseUrl: url, token, hostToken });
    try {
      await client.health();
    } catch (error) {
      const resolved = error as iPolloWorkServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as iPolloWorkServerStatus, capabilities: null };
      }
      return { status: "disconnected" as iPolloWorkServerStatus, capabilities: null };
    }

    if (!token) {
      return { status: "limited" as iPolloWorkServerStatus, capabilities: null };
    }

    try {
      const capabilities = await client.capabilities();
      return { status: "connected" as iPolloWorkServerStatus, capabilities };
    } catch (error) {
      const resolved = error as iPolloWorkServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as iPolloWorkServerStatus, capabilities: null };
      }
      return { status: "disconnected" as iPolloWorkServerStatus, capabilities: null };
    }
  };

  const clearHealthTimeout = () => {
    if (healthTimeoutId !== null) {
      window.clearTimeout(healthTimeoutId);
      healthTimeoutId = null;
    }
  };

  const queueHealthCheck = (delayMs: number) => {
    if (disposed || typeof window === "undefined") return;
    clearHealthTimeout();
    healthTimeoutId = window.setTimeout(() => {
      healthTimeoutId = null;
      void runHealthCheck();
    }, Math.max(0, delayMs));
  };

  const runHealthCheck = async () => {
    if (disposed || typeof window === "undefined") return;
    if (!options.documentVisible()) {
      queueHealthCheck(healthDelayMs);
      return;
    }
    if (shouldWaitForLocalHostInfo()) {
      queueHealthCheck(250);
      return;
    }
    if (healthBusy) return;

    const url = getBaseUrl().trim();
    const auth = getAuth();
    if (!url) {
      consecutiveHealthFailures = 0;
      mutateState((current) => ({
        ...current,
        ipolloworkServerStatus: "disconnected",
        ipolloworkServerCapabilities: null,
        ipolloworkServerCheckedAt: Date.now(),
      }));
      return;
    }

    healthBusy = true;
    try {
      let result = await checkiPolloWorkServer(url, auth.token, auth.hostToken);

      if (shouldRetryStartupCheck(result.status)) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        if (disposed) return;

        try {
          const info = await ipolloworkServerInfo() as iPolloWorkServerInfo;
          if (disposed) return;

          mutateState((current) => ({
            ...current,
            ipolloworkServerHostInfo: info,
            ipolloworkServerHostInfoReady: true,
          }));

          const retryUrl = info.baseUrl?.trim() ?? "";
          const retryToken = info.clientToken?.trim() || undefined;
          const retryHostToken = info.hostToken?.trim() || undefined;
          if (retryUrl) {
            result = await checkiPolloWorkServer(retryUrl, retryToken, retryHostToken);
          }
        } catch {
          // Preserve the original check result when the retry probe fails.
        }
      }

      if (disposed) return;
      const previousStatus = state.ipolloworkServerStatus;
      const previousCapabilities = state.ipolloworkServerCapabilities;
      const healthy = result.status === "connected" || result.status === "limited";
      if (healthy) {
        consecutiveHealthFailures = 0;
        healthDelayMs = 10_000;
      } else {
        consecutiveHealthFailures += 1;
        healthDelayMs = Math.min(healthDelayMs * 2, 60_000);
      }

      const preservePrevious =
        !healthy &&
        consecutiveHealthFailures < 3 &&
        (previousStatus === "connected" || previousStatus === "limited");

      mutateState((current) => ({
        ...current,
        ipolloworkServerStatus: preservePrevious ? previousStatus : result.status,
        ipolloworkServerCapabilities: preservePrevious ? previousCapabilities : result.capabilities,
        ipolloworkServerCheckedAt: Date.now(),
      }));
    } catch {
      healthDelayMs = Math.min(healthDelayMs * 2, 60_000);
      mutateState((current) => ({
        ...current,
        ipolloworkServerCheckedAt: Date.now(),
      }));
    } finally {
      healthBusy = false;
      if (!disposed) queueHealthCheck(healthDelayMs);
    }
  };

  const syncFromOptions = () => {
    refreshSnapshot();
    emitChange();

    if (!isDesktopRuntime()) return;
    const port = state.ipolloworkServerHostInfo?.port;
    if (!port) return;
    if (state.ipolloworkServerSettings.portOverride === port) return;

    updateiPolloWorkServerSettings({
      ...state.ipolloworkServerSettings,
      portOverride: port,
    });
  };

  const startInterval = (key: string, fn: () => void, ms: number) => {
    if (typeof window === "undefined") return;
    if (intervals.has(key)) return;
    intervals.set(key, window.setInterval(fn, ms));
  };

  const stopInterval = (key: string) => {
    const id = intervals.get(key);
    if (id === undefined) return;
    window.clearInterval(id);
    intervals.delete(key);
  };

  const start = () => {
    if (typeof window === "undefined") return;
    if (started) return;
    // Allow restart after a prior dispose() (React 18 StrictMode double-mounts
    // each effect in dev: mount → dispose → re-mount). If we early-return when
    // `disposed` is true, the real mount never arms polling and the UI stays
    // on stale/empty state forever.
    disposed = false;
    started = true;

    syncFromOptions();
    queueHealthCheck(0);
    visibilityChangeHandler = () => {
      if (!options.documentVisible()) return;
      consecutiveHealthFailures = 0;
      queueHealthCheck(0);
    };
    window.addEventListener("visibilitychange", visibilityChangeHandler);

    const refreshHostInfo = () => {
      if (!isDesktopRuntime()) return;
      if (!options.documentVisible()) return;
      void (async () => {
        try {
          const info = await ipolloworkServerInfo() as iPolloWorkServerInfo;
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipolloworkServerHostInfo: info,
            ipolloworkServerHostInfoReady: true,
          }));
        } catch {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipolloworkServerHostInfo: null,
            ipolloworkServerHostInfoReady: true,
          }));
        }
      })();
    };
    refreshHostInfo();
    startInterval("hostInfo", refreshHostInfo, 10_000);

    const refreshDiagnostics = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("ipolloworkServerDiagnostics", null);
        return;
      }

      const client = getClient();
      if (!client || state.ipolloworkServerStatus === "disconnected") {
        setStateField("ipolloworkServerDiagnostics", null);
        return;
      }

      void (async () => {
        try {
          const status = await client.status();
          if (!disposed) setStateField("ipolloworkServerDiagnostics", status);
        } catch {
          if (!disposed) setStateField("ipolloworkServerDiagnostics", null);
        }
      })();
    };
    refreshDiagnostics();
    startInterval("diagnostics", refreshDiagnostics, 10_000);

    const refreshDevtoolsWorkspace = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("devtoolsWorkspaceId", null);
        return;
      }

      const client = getClient();
      if (!client) {
        setStateField("devtoolsWorkspaceId", null);
        return;
      }

      void (async () => {
        try {
          const response = await client.listWorkspaces();
          if (disposed) return;
          const items = Array.isArray(response.items) ? response.items : [];
          const activeMatch = response.activeId
            ? items.find((item) => item.id === response.activeId)
            : null;
          setStateField("devtoolsWorkspaceId", activeMatch?.id ?? items[0]?.id ?? null);
        } catch {
          if (!disposed) setStateField("devtoolsWorkspaceId", null);
        }
      })();
    };
    refreshDevtoolsWorkspace();
    startInterval("devtoolsWorkspace", refreshDevtoolsWorkspace, 20_000);

    const refreshAudit = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        mutateState((current) => ({
          ...current,
          ipolloworkAuditEntries: [],
          ipolloworkAuditStatus: "idle",
          ipolloworkAuditError: null,
        }));
        return;
      }

      const client = getClient();
      const workspaceId = state.devtoolsWorkspaceId;
      if (!client || !workspaceId) {
        mutateState((current) => ({
          ...current,
          ipolloworkAuditEntries: [],
          ipolloworkAuditStatus: "idle",
          ipolloworkAuditError: null,
        }));
        return;
      }

      mutateState((current) => ({
        ...current,
        ipolloworkAuditStatus: "loading",
        ipolloworkAuditError: null,
      }));

      void (async () => {
        try {
          const result = await client.listAudit(workspaceId, 50);
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipolloworkAuditEntries: Array.isArray(result.items) ? result.items : [],
            ipolloworkAuditStatus: "idle",
          }));
        } catch (error) {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipolloworkAuditEntries: [],
            ipolloworkAuditStatus: "error",
            ipolloworkAuditError:
              error instanceof Error
                ? error.message
                : t("app.error_audit_load"),
          }));
        }
      })();
    };
    refreshAudit();
    startInterval("audit", refreshAudit, 15_000);
  };

  const dispose = () => {
    disposed = true;
    started = false;
    clearHealthTimeout();
    if (visibilityChangeHandler && typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", visibilityChangeHandler);
      visibilityChangeHandler = null;
    }
    for (const key of [...intervals.keys()]) stopInterval(key);
  };

  const testiPolloWorkServerConnection = async (next: iPolloWorkServerSettings) => {
    const derived = normalizeiPolloWorkServerUrl(next.urlOverride ?? "");
    if (!derived) {
      mutateState((current) => ({
        ...current,
        ipolloworkServerStatus: "disconnected",
        ipolloworkServerCapabilities: null,
        ipolloworkServerCheckedAt: Date.now(),
      }));
      return false;
    }

    const result = await checkiPolloWorkServer(derived, next.token);
    consecutiveHealthFailures = result.status === "disconnected" ? consecutiveHealthFailures + 1 : 0;
    mutateState((current) => ({
      ...current,
      ipolloworkServerStatus: result.status,
      ipolloworkServerCapabilities: result.capabilities,
      ipolloworkServerCheckedAt: Date.now(),
    }));

    const ok = result.status === "connected" || result.status === "limited";
    if (ok && !isDesktopRuntime()) {
      const active = options.selectedWorkspaceDisplay();
      const shouldAttach =
        !options.activeClient() ||
        active.workspaceType !== "remote" ||
        active.remoteType !== "ipollowork";
      if (shouldAttach) {
        await options
          .createRemoteWorkspaceFlow({
            ipolloworkHostUrl: derived,
            ipolloworkToken: next.token ?? null,
          })
          .catch(() => undefined);
      }
    }
    return ok;
  };

  const reconnectiPolloWorkServer = async () => {
    if (state.ipolloworkReconnectBusy) return false;
    setStateField("ipolloworkReconnectBusy", true);

    try {
      let hostInfo = state.ipolloworkServerHostInfo;
      if (isDesktopRuntime()) {
        try {
          hostInfo = await ipolloworkServerInfo() as iPolloWorkServerInfo;
          mutateState((current) => ({ ...current, ipolloworkServerHostInfo: hostInfo }));
        } catch {
          hostInfo = null;
          setStateField("ipolloworkServerHostInfo", null);
        }
      }

      if (hostInfo?.clientToken?.trim() && options.startupPreference() !== "server") {
        const liveToken = hostInfo.clientToken.trim();
        const settings = state.ipolloworkServerSettings;
        if ((settings.token?.trim() ?? "") !== liveToken) {
          updateiPolloWorkServerSettings({ ...settings, token: liveToken });
        }
      }

      const url = getBaseUrl().trim();
      const auth = getAuth();
      if (!url) {
        mutateState((current) => ({
          ...current,
          ipolloworkServerStatus: "disconnected",
          ipolloworkServerCapabilities: null,
          ipolloworkServerCheckedAt: Date.now(),
        }));
        return false;
      }

      const result = await checkiPolloWorkServer(url, auth.token, auth.hostToken);
      mutateState((current) => ({
        ...current,
        ipolloworkServerStatus: result.status,
        ipolloworkServerCapabilities: result.capabilities,
        ipolloworkServerCheckedAt: Date.now(),
      }));
      return result.status === "connected" || result.status === "limited";
    } finally {
      setStateField("ipolloworkReconnectBusy", false);
    }
  };

  async function ensureLocaliPolloWorkServerClient(): Promise<iPolloWorkServerClient | null> {
    let hostInfo = state.ipolloworkServerHostInfo;
    if (hostInfo?.baseUrl?.trim() && hostInfo.clientToken?.trim()) {
      const existing = createiPolloWorkServerClient({
        baseUrl: hostInfo.baseUrl.trim(),
        token: hostInfo.clientToken.trim(),
        hostToken: hostInfo.hostToken?.trim() || undefined,
      });
      try {
        await existing.health();
        if (options.startupPreference() !== "server") {
          await reconnectiPolloWorkServer();
        }
        return existing;
      } catch {
        // Fall through to a local restart.
      }
    }

    if (!isDesktopRuntime()) return null;

    try {
      hostInfo = await ipolloworkServerRestart({
        remoteAccessEnabled: state.ipolloworkServerSettings.remoteAccessEnabled === true,
      }) as iPolloWorkServerInfo;
      mutateState((current) => ({ ...current, ipolloworkServerHostInfo: hostInfo }));
    } catch {
      return null;
    }

    const baseUrl = hostInfo?.baseUrl?.trim() ?? "";
    const token = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";
    if (!baseUrl || !token) return null;

    if (options.startupPreference() !== "server") {
      await reconnectiPolloWorkServer();
    }

    return createiPolloWorkServerClient({
      baseUrl,
      token,
      hostToken: hostToken || undefined,
    });
  }

  const saveShareRemoteAccess = async (enabled: boolean) => {
    if (state.shareRemoteAccessBusy) return;
    const previous = state.ipolloworkServerSettings;
    const next: iPolloWorkServerSettings = {
      ...previous,
      remoteAccessEnabled: enabled,
    };

    mutateState((current) => ({
      ...current,
      shareRemoteAccessBusy: true,
      shareRemoteAccessError: null,
    }));
    updateiPolloWorkServerSettings(next);

    try {
      if (isDesktopRuntime() && options.selectedWorkspaceDisplay().workspaceType === "local") {
        const restarted = await options.restartLocalServer();
        if (!restarted) {
          throw new Error(t("app.error_restart_local_worker"));
        }
        await reconnectiPolloWorkServer();
      }
    } catch (error) {
      updateiPolloWorkServerSettings(previous);
      mutateState((current) => ({
        ...current,
        shareRemoteAccessError:
          error instanceof Error
            ? error.message
            : t("app.error_remote_access"),
      }));
      return;
    } finally {
      setStateField("shareRemoteAccessBusy", false);
    }
  };

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    setiPolloWorkServerSettings,
    updateiPolloWorkServerSettings,
    resetiPolloWorkServerSettings,
    saveShareRemoteAccess,
    checkiPolloWorkServer,
    testiPolloWorkServerConnection,
    reconnectiPolloWorkServer,
    ensureLocaliPolloWorkServerClient,
  };
}

export function useiPolloWorkServerStoreSnapshot(store: iPolloWorkServerStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
