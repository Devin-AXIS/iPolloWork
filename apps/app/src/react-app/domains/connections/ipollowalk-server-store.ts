import { useSyncExternalStore } from "react";

import { t } from "../../../i18n";
import type { StartupPreference, WorkspaceDisplay } from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import {
  ipollowalkServerInfo,
  ipollowalkServerRestart,
  type iPolloWalkServerInfo,
} from "../../../app/lib/desktop";
import {
  cleariPolloWalkServerSettings,
  createiPolloWalkServerClient,
  isLoopbackiPolloWalkServerUrl,
  normalizeiPolloWalkServerUrl,
  readiPolloWalkServerSettings,
  writeiPolloWalkServerSettings,
  type iPolloWalkAuditEntry,
  type iPolloWalkServerCapabilities,
  type iPolloWalkServerClient,
  type iPolloWalkServerDiagnostics,
  type iPolloWalkServerError,
  type iPolloWalkServerSettings,
  type iPolloWalkServerStatus,
} from "../../../app/lib/ipollowalk-server";

type SetStateAction<T> = T | ((current: T) => T);

type RemoteWorkspaceInput = {
  ipollowalkHostUrl: string;
  ipollowalkToken?: string | null;
  directory?: string | null;
  displayName?: string | null;
};

export type iPolloWalkServerStoreSnapshot = {
  ipollowalkServerSettings: iPolloWalkServerSettings;
  shareRemoteAccessBusy: boolean;
  shareRemoteAccessError: string | null;
  ipollowalkServerUrl: string;
  ipollowalkServerBaseUrl: string;
  ipollowalkServerAuth: { token?: string; hostToken?: string };
  ipollowalkServerClient: iPolloWalkServerClient | null;
  ipollowalkServerStatus: iPolloWalkServerStatus;
  ipollowalkServerCapabilities: iPolloWalkServerCapabilities | null;
  ipollowalkServerReady: boolean;
  ipollowalkServerWorkspaceReady: boolean;
  resolvediPolloWalkCapabilities: iPolloWalkServerCapabilities | null;
  ipollowalkServerCanWriteSkills: boolean;
  ipollowalkServerCanWritePlugins: boolean;
  ipollowalkServerHostInfo: iPolloWalkServerInfo | null;
  ipollowalkServerDiagnostics: iPolloWalkServerDiagnostics | null;
  ipollowalkReconnectBusy: boolean;
  ipollowalkAuditEntries: iPolloWalkAuditEntry[];
  ipollowalkAuditStatus: "idle" | "loading" | "error";
  ipollowalkAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

export type iPolloWalkServerStore = ReturnType<typeof createiPolloWalkServerStore>;

type CreateiPolloWalkServerStoreOptions = {
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
  ipollowalkServerSettings: iPolloWalkServerSettings;
  shareRemoteAccessBusy: boolean;
  shareRemoteAccessError: string | null;
  ipollowalkServerUrl: string;
  ipollowalkServerStatus: iPolloWalkServerStatus;
  ipollowalkServerCapabilities: iPolloWalkServerCapabilities | null;
  ipollowalkServerCheckedAt: number | null;
  ipollowalkServerHostInfo: iPolloWalkServerInfo | null;
  ipollowalkServerHostInfoReady: boolean;
  ipollowalkServerDiagnostics: iPolloWalkServerDiagnostics | null;
  ipollowalkReconnectBusy: boolean;
  ipollowalkAuditEntries: iPolloWalkAuditEntry[];
  ipollowalkAuditStatus: "idle" | "loading" | "error";
  ipollowalkAuditError: string | null;
  devtoolsWorkspaceId: string | null;
};

const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
  typeof next === "function" ? (next as (value: T) => T)(current) : next;

export function createiPolloWalkServerStore(options: CreateiPolloWalkServerStoreOptions) {
  const bootStartedAt = Date.now();
  const listeners = new Set<() => void>();
  const intervals = new Map<string, number>();

  let clientCacheKey = "";
  let clientCacheValue: iPolloWalkServerClient | null = null;
  let started = false;
  let disposed = false;
  let healthTimeoutId: number | null = null;
  let healthBusy = false;
  let healthDelayMs = 10_000;
  let consecutiveHealthFailures = 0;
  let visibilityChangeHandler: (() => void) | null = null;
  let snapshot: iPolloWalkServerStoreSnapshot;

  let state: MutableState = {
    ipollowalkServerSettings: readiPolloWalkServerSettings(),
    shareRemoteAccessBusy: false,
    shareRemoteAccessError: null,
    ipollowalkServerUrl: "",
    ipollowalkServerStatus: "disconnected",
    ipollowalkServerCapabilities: null,
    ipollowalkServerCheckedAt: null,
    ipollowalkServerHostInfo: null,
    ipollowalkServerHostInfoReady: !isDesktopRuntime(),
    ipollowalkServerDiagnostics: null,
    ipollowalkReconnectBusy: false,
    ipollowalkAuditEntries: [],
    ipollowalkAuditStatus: "idle",
    ipollowalkAuditError: null,
    devtoolsWorkspaceId: null,
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getBaseUrl = () => {
    const pref = options.startupPreference();
    const hostInfo = state.ipollowalkServerHostInfo;
    const settingsUrl = normalizeiPolloWalkServerUrl(state.ipollowalkServerSettings.urlOverride ?? "") ?? "";

    if (pref === "local") return hostInfo?.baseUrl ?? "";
    if (pref === "server" && settingsUrl && isLoopbackiPolloWalkServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return hostInfo.baseUrl;
    }
    if (pref === "server") return settingsUrl;
    return hostInfo?.baseUrl ?? settingsUrl;
  };

  const getAuth = () => {
    const pref = options.startupPreference();
    const hostInfo = state.ipollowalkServerHostInfo;
    const settingsUrl = normalizeiPolloWalkServerUrl(state.ipollowalkServerSettings.urlOverride ?? "") ?? "";
    const settingsToken = state.ipollowalkServerSettings.token?.trim() ?? "";
    const settingsHostToken = state.ipollowalkServerSettings.hostToken?.trim() ?? "";
    const clientToken = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";

    if (pref === "local") {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    if (pref === "server" && settingsUrl && isLoopbackiPolloWalkServerUrl(settingsUrl) && hostInfo?.baseUrl) {
      return {
        token: clientToken || settingsToken || undefined,
        hostToken: hostToken || settingsHostToken || undefined,
      };
    }
    if (pref === "server") {
      return {
        token: settingsToken || undefined,
        hostToken: settingsUrl && isLoopbackiPolloWalkServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
      };
    }
    if (hostInfo?.baseUrl) {
      return { token: clientToken || undefined, hostToken: hostToken || undefined };
    }
    return {
      token: settingsToken || undefined,
      hostToken: settingsUrl && isLoopbackiPolloWalkServerUrl(settingsUrl) ? settingsHostToken || undefined : undefined,
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
      clientCacheValue = createiPolloWalkServerClient({
        baseUrl,
        token: auth.token,
        hostToken: auth.hostToken,
      });
    }
    return clientCacheValue;
  };

  const refreshSnapshot = () => {
    const ipollowalkServerBaseUrl = getBaseUrl().trim();
    const ipollowalkServerAuth = getAuth();
    const ipollowalkServerClient = getClient();
    const ipollowalkServerReady = state.ipollowalkServerStatus === "connected";
    const ipollowalkServerWorkspaceReady = Boolean(options.runtimeWorkspaceId());
    const resolvediPolloWalkCapabilities = state.ipollowalkServerCapabilities;

    const pref = options.startupPreference();
    const info = state.ipollowalkServerHostInfo;
    const hostUrl = info?.connectUrl ?? info?.lanUrl ?? info?.mdnsUrl ?? info?.baseUrl ?? "";
    const settingsUrl = normalizeiPolloWalkServerUrl(state.ipollowalkServerSettings.urlOverride ?? "") ?? "";

    let ipollowalkServerUrl = hostUrl || settingsUrl;
    if (pref === "local") ipollowalkServerUrl = hostUrl;
    if (pref === "server") ipollowalkServerUrl = settingsUrl;
    state.ipollowalkServerUrl = ipollowalkServerUrl;

    snapshot = {
      ipollowalkServerSettings: state.ipollowalkServerSettings,
      shareRemoteAccessBusy: state.shareRemoteAccessBusy,
      shareRemoteAccessError: state.shareRemoteAccessError,
      ipollowalkServerUrl,
      ipollowalkServerBaseUrl,
      ipollowalkServerAuth,
      ipollowalkServerClient,
      ipollowalkServerStatus: state.ipollowalkServerStatus,
      ipollowalkServerCapabilities: state.ipollowalkServerCapabilities,
      ipollowalkServerReady,
      ipollowalkServerWorkspaceReady,
      resolvediPolloWalkCapabilities,
      ipollowalkServerCanWriteSkills:
        ipollowalkServerReady &&
        (resolvediPolloWalkCapabilities?.skills?.write ?? false),
      ipollowalkServerCanWritePlugins:
        ipollowalkServerReady &&
        (resolvediPolloWalkCapabilities?.plugins?.write ?? false),
      ipollowalkServerHostInfo: state.ipollowalkServerHostInfo,
      ipollowalkServerDiagnostics: state.ipollowalkServerDiagnostics,
      ipollowalkReconnectBusy: state.ipollowalkReconnectBusy,
      ipollowalkAuditEntries: state.ipollowalkAuditEntries,
      ipollowalkAuditStatus: state.ipollowalkAuditStatus,
      ipollowalkAuditError: state.ipollowalkAuditError,
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

  const setiPolloWalkServerSettings = (next: SetStateAction<iPolloWalkServerSettings>) => {
    const resolved = applyStateAction(state.ipollowalkServerSettings, next);
    mutateState((current) => ({ ...current, ipollowalkServerSettings: resolved }));
    queueHealthCheck(0);
  };

  const updateiPolloWalkServerSettings = (next: iPolloWalkServerSettings) => {
    const stored = writeiPolloWalkServerSettings(next);
    mutateState((current) => ({ ...current, ipollowalkServerSettings: stored }));
    queueHealthCheck(0);
  };

  const resetiPolloWalkServerSettings = () => {
    cleariPolloWalkServerSettings();
    mutateState((current) => ({ ...current, ipollowalkServerSettings: {} }));
    queueHealthCheck(0);
  };

  const shouldWaitForLocalHostInfo = () =>
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    !state.ipollowalkServerHostInfoReady;

  const shouldRetryStartupCheck = (status: iPolloWalkServerStatus) =>
    status !== "connected" &&
    isDesktopRuntime() &&
    options.startupPreference() !== "server" &&
    Date.now() - bootStartedAt < 5_000;

  const checkiPolloWalkServer = async (url: string, token?: string, hostToken?: string) => {
    const client = createiPolloWalkServerClient({ baseUrl: url, token, hostToken });
    try {
      await client.health();
    } catch (error) {
      const resolved = error as iPolloWalkServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as iPolloWalkServerStatus, capabilities: null };
      }
      return { status: "disconnected" as iPolloWalkServerStatus, capabilities: null };
    }

    if (!token) {
      return { status: "limited" as iPolloWalkServerStatus, capabilities: null };
    }

    try {
      const capabilities = await client.capabilities();
      return { status: "connected" as iPolloWalkServerStatus, capabilities };
    } catch (error) {
      const resolved = error as iPolloWalkServerError | Error;
      if ("status" in resolved && (resolved.status === 401 || resolved.status === 403)) {
        return { status: "limited" as iPolloWalkServerStatus, capabilities: null };
      }
      return { status: "disconnected" as iPolloWalkServerStatus, capabilities: null };
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
        ipollowalkServerStatus: "disconnected",
        ipollowalkServerCapabilities: null,
        ipollowalkServerCheckedAt: Date.now(),
      }));
      return;
    }

    healthBusy = true;
    try {
      let result = await checkiPolloWalkServer(url, auth.token, auth.hostToken);

      if (shouldRetryStartupCheck(result.status)) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        if (disposed) return;

        try {
          const info = await ipollowalkServerInfo() as iPolloWalkServerInfo;
          if (disposed) return;

          mutateState((current) => ({
            ...current,
            ipollowalkServerHostInfo: info,
            ipollowalkServerHostInfoReady: true,
          }));

          const retryUrl = info.baseUrl?.trim() ?? "";
          const retryToken = info.clientToken?.trim() || undefined;
          const retryHostToken = info.hostToken?.trim() || undefined;
          if (retryUrl) {
            result = await checkiPolloWalkServer(retryUrl, retryToken, retryHostToken);
          }
        } catch {
          // Preserve the original check result when the retry probe fails.
        }
      }

      if (disposed) return;
      const previousStatus = state.ipollowalkServerStatus;
      const previousCapabilities = state.ipollowalkServerCapabilities;
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
        ipollowalkServerStatus: preservePrevious ? previousStatus : result.status,
        ipollowalkServerCapabilities: preservePrevious ? previousCapabilities : result.capabilities,
        ipollowalkServerCheckedAt: Date.now(),
      }));
    } catch {
      healthDelayMs = Math.min(healthDelayMs * 2, 60_000);
      mutateState((current) => ({
        ...current,
        ipollowalkServerCheckedAt: Date.now(),
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
    const port = state.ipollowalkServerHostInfo?.port;
    if (!port) return;
    if (state.ipollowalkServerSettings.portOverride === port) return;

    updateiPolloWalkServerSettings({
      ...state.ipollowalkServerSettings,
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
          const info = await ipollowalkServerInfo() as iPolloWalkServerInfo;
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipollowalkServerHostInfo: info,
            ipollowalkServerHostInfoReady: true,
          }));
        } catch {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipollowalkServerHostInfo: null,
            ipollowalkServerHostInfoReady: true,
          }));
        }
      })();
    };
    refreshHostInfo();
    startInterval("hostInfo", refreshHostInfo, 10_000);

    const refreshDiagnostics = () => {
      if (!options.documentVisible()) return;
      if (!options.developerMode()) {
        setStateField("ipollowalkServerDiagnostics", null);
        return;
      }

      const client = getClient();
      if (!client || state.ipollowalkServerStatus === "disconnected") {
        setStateField("ipollowalkServerDiagnostics", null);
        return;
      }

      void (async () => {
        try {
          const status = await client.status();
          if (!disposed) setStateField("ipollowalkServerDiagnostics", status);
        } catch {
          if (!disposed) setStateField("ipollowalkServerDiagnostics", null);
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
          ipollowalkAuditEntries: [],
          ipollowalkAuditStatus: "idle",
          ipollowalkAuditError: null,
        }));
        return;
      }

      const client = getClient();
      const workspaceId = state.devtoolsWorkspaceId;
      if (!client || !workspaceId) {
        mutateState((current) => ({
          ...current,
          ipollowalkAuditEntries: [],
          ipollowalkAuditStatus: "idle",
          ipollowalkAuditError: null,
        }));
        return;
      }

      mutateState((current) => ({
        ...current,
        ipollowalkAuditStatus: "loading",
        ipollowalkAuditError: null,
      }));

      void (async () => {
        try {
          const result = await client.listAudit(workspaceId, 50);
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipollowalkAuditEntries: Array.isArray(result.items) ? result.items : [],
            ipollowalkAuditStatus: "idle",
          }));
        } catch (error) {
          if (disposed) return;
          mutateState((current) => ({
            ...current,
            ipollowalkAuditEntries: [],
            ipollowalkAuditStatus: "error",
            ipollowalkAuditError:
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

  const testiPolloWalkServerConnection = async (next: iPolloWalkServerSettings) => {
    const derived = normalizeiPolloWalkServerUrl(next.urlOverride ?? "");
    if (!derived) {
      mutateState((current) => ({
        ...current,
        ipollowalkServerStatus: "disconnected",
        ipollowalkServerCapabilities: null,
        ipollowalkServerCheckedAt: Date.now(),
      }));
      return false;
    }

    const result = await checkiPolloWalkServer(derived, next.token);
    consecutiveHealthFailures = result.status === "disconnected" ? consecutiveHealthFailures + 1 : 0;
    mutateState((current) => ({
      ...current,
      ipollowalkServerStatus: result.status,
      ipollowalkServerCapabilities: result.capabilities,
      ipollowalkServerCheckedAt: Date.now(),
    }));

    const ok = result.status === "connected" || result.status === "limited";
    if (ok && !isDesktopRuntime()) {
      const active = options.selectedWorkspaceDisplay();
      const shouldAttach =
        !options.activeClient() ||
        active.workspaceType !== "remote" ||
        active.remoteType !== "ipollowalk";
      if (shouldAttach) {
        await options
          .createRemoteWorkspaceFlow({
            ipollowalkHostUrl: derived,
            ipollowalkToken: next.token ?? null,
          })
          .catch(() => undefined);
      }
    }
    return ok;
  };

  const reconnectiPolloWalkServer = async () => {
    if (state.ipollowalkReconnectBusy) return false;
    setStateField("ipollowalkReconnectBusy", true);

    try {
      let hostInfo = state.ipollowalkServerHostInfo;
      if (isDesktopRuntime()) {
        try {
          hostInfo = await ipollowalkServerInfo() as iPolloWalkServerInfo;
          mutateState((current) => ({ ...current, ipollowalkServerHostInfo: hostInfo }));
        } catch {
          hostInfo = null;
          setStateField("ipollowalkServerHostInfo", null);
        }
      }

      if (hostInfo?.clientToken?.trim() && options.startupPreference() !== "server") {
        const liveToken = hostInfo.clientToken.trim();
        const settings = state.ipollowalkServerSettings;
        if ((settings.token?.trim() ?? "") !== liveToken) {
          updateiPolloWalkServerSettings({ ...settings, token: liveToken });
        }
      }

      const url = getBaseUrl().trim();
      const auth = getAuth();
      if (!url) {
        mutateState((current) => ({
          ...current,
          ipollowalkServerStatus: "disconnected",
          ipollowalkServerCapabilities: null,
          ipollowalkServerCheckedAt: Date.now(),
        }));
        return false;
      }

      const result = await checkiPolloWalkServer(url, auth.token, auth.hostToken);
      mutateState((current) => ({
        ...current,
        ipollowalkServerStatus: result.status,
        ipollowalkServerCapabilities: result.capabilities,
        ipollowalkServerCheckedAt: Date.now(),
      }));
      return result.status === "connected" || result.status === "limited";
    } finally {
      setStateField("ipollowalkReconnectBusy", false);
    }
  };

  async function ensureLocaliPolloWalkServerClient(): Promise<iPolloWalkServerClient | null> {
    let hostInfo = state.ipollowalkServerHostInfo;
    if (hostInfo?.baseUrl?.trim() && hostInfo.clientToken?.trim()) {
      const existing = createiPolloWalkServerClient({
        baseUrl: hostInfo.baseUrl.trim(),
        token: hostInfo.clientToken.trim(),
        hostToken: hostInfo.hostToken?.trim() || undefined,
      });
      try {
        await existing.health();
        if (options.startupPreference() !== "server") {
          await reconnectiPolloWalkServer();
        }
        return existing;
      } catch {
        // Fall through to a local restart.
      }
    }

    if (!isDesktopRuntime()) return null;

    try {
      hostInfo = await ipollowalkServerRestart({
        remoteAccessEnabled: state.ipollowalkServerSettings.remoteAccessEnabled === true,
      }) as iPolloWalkServerInfo;
      mutateState((current) => ({ ...current, ipollowalkServerHostInfo: hostInfo }));
    } catch {
      return null;
    }

    const baseUrl = hostInfo?.baseUrl?.trim() ?? "";
    const token = hostInfo?.clientToken?.trim() ?? "";
    const hostToken = hostInfo?.hostToken?.trim() ?? "";
    if (!baseUrl || !token) return null;

    if (options.startupPreference() !== "server") {
      await reconnectiPolloWalkServer();
    }

    return createiPolloWalkServerClient({
      baseUrl,
      token,
      hostToken: hostToken || undefined,
    });
  }

  const saveShareRemoteAccess = async (enabled: boolean) => {
    if (state.shareRemoteAccessBusy) return;
    const previous = state.ipollowalkServerSettings;
    const next: iPolloWalkServerSettings = {
      ...previous,
      remoteAccessEnabled: enabled,
    };

    mutateState((current) => ({
      ...current,
      shareRemoteAccessBusy: true,
      shareRemoteAccessError: null,
    }));
    updateiPolloWalkServerSettings(next);

    try {
      if (isDesktopRuntime() && options.selectedWorkspaceDisplay().workspaceType === "local") {
        const restarted = await options.restartLocalServer();
        if (!restarted) {
          throw new Error(t("app.error_restart_local_worker"));
        }
        await reconnectiPolloWalkServer();
      }
    } catch (error) {
      updateiPolloWalkServerSettings(previous);
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
    setiPolloWalkServerSettings,
    updateiPolloWalkServerSettings,
    resetiPolloWalkServerSettings,
    saveShareRemoteAccess,
    checkiPolloWalkServer,
    testiPolloWalkServerConnection,
    reconnectiPolloWalkServer,
    ensureLocaliPolloWalkServerClient,
  };
}

export function useiPolloWalkServerStoreSnapshot(store: iPolloWalkServerStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
