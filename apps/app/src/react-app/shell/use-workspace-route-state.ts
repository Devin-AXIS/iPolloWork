// The session route's data + navigation core: workspace/session loading
// (refreshRouteState + background session fetch), endpoint and opencode
// client resolution, URL-derived selection, redirects (fallback workspace,
// last-session restore, welcome), desktop local-server reconnect, remote
// connection checks, and the route inspector slice. Extracted verbatim from
// session-route.tsx as the final step of its decomposition; the route keeps
// composition, handlers, and JSX.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { publishInspectorSlice, recordInspectorEvent } from "@/app/lib/app-inspector";
import {
  desktopResumeEvent,
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type iPolloWorkServerInfo,
  type WorkspaceList,
} from "@/app/lib/desktop";
import { createClient } from "@/app/lib/opencode";
import { createiPolloWorkServerClient, type iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import {
  filterWorkspacesForWorkContext,
  finishWorkContextSwitch,
  type WorkContextId,
} from "@/app/lib/work-context";
import {
  resolveWorkspaceEndpoint,
  type ResolvedWorkspaceEndpoint,
} from "@/app/lib/workspace-endpoint";
import type { WorkspaceConnectionState } from "@/app/types";
import { t } from "@/i18n";
import {
  diagnoseRemoteWorkspaceTaskLoadFailure,
  getRemoteWorkspaceConnectionKey,
  testRemoteWorkspaceConnection,
} from "@/react-app/domains/workspace/remote-workspace-diagnostics";
import { useLocal } from "@/react-app/kernel/local-provider";
import { setTemplateSessionTypes } from "@/react-app/domains/session/sidebar/session-type";
import { useBootState } from "./boot-state";
import { ensureDesktopLocaliPolloWorkConnection } from "./desktop-local-ipollowork";
import { resolveiPolloWorkConnection } from "./ipollowork-connection";
import {
  describeRouteError,
  isTransientStartupError,
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
  orderRouteWorkspaces,
  partitionInitialWorkspaceLoads,
  reconcilePendingCreatedSessions,
  resolveKnownWorkspaceId,
  type RouteSession,
  type RouteWorkspace,
} from "./route-workspaces";
import {
  readActiveWorkspaceId,
  readSessionDirectoryCache,
  writeActiveWorkspaceId,
  writeSessionDirectoryCache,
} from "./session-memory";
import { legacySessionRoute, workspaceSessionRoute } from "./workspace-routes";

export type UseWorkspaceRouteStateInput = {
  workContextId: WorkContextId;
  /** Invoked when the ipollowork-server settings-changed event fires (the route bumps its settings version). */
  onServerSettingsChanged: () => void;
  /** Receives the local ipollowork-server host info discovered during refresh. */
  onHostInfo: (info: iPolloWorkServerInfo | null) => void;
};

function waitForCommittedRouteState(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = window.setTimeout(finish, 100);
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });
}

let STARTUP_ROUTE_TIMING_REPORTED = false;
const SELECTED_WORKSPACE_SESSION_SYNC_INTERVAL_MS = 15_000;

export function useWorkspaceRouteState(input: UseWorkspaceRouteStateInput) {
  const { workContextId, onServerSettingsChanged, onHostInfo } = input;
  const navigate = useNavigate();
  const local = useLocal();
  const params = useParams<{ workspaceId?: string; sessionId?: string }>();
  const routeWorkspaceId = params.workspaceId?.trim() || "";
  const selectedSessionId = params.sessionId?.trim() || null;
  const routeSelectionRef = useRef({ workspaceId: routeWorkspaceId, sessionId: selectedSessionId });
  routeSelectionRef.current = { workspaceId: routeWorkspaceId, sessionId: selectedSessionId };
  const navigateToWorkspaceSession = useCallback((workspaceId: string, sessionId?: string | null, options?: { replace?: boolean }) => {
    const id = workspaceId.trim();
    if (!id) {
      navigate(legacySessionRoute(sessionId), options);
      return;
    }
    navigate(workspaceSessionRoute(id, sessionId), options);
  }, [navigate]);

  const { markRouteReady: markBootRouteReady } = useBootState();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<iPolloWorkServerClient | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<Record<string, RouteSession[]>>(
    () => readSessionDirectoryCache(),
  );
  const [errorsByWorkspaceId, setErrorsByWorkspaceId] = useState<Record<string, string | null>>({});
  const [workspaceConnectionOverrides, setWorkspaceConnectionOverrides] = useState<Record<string, WorkspaceConnectionState>>({});
  const [routeError, setRouteError] = useState<string | null>(null);
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] = useState<string>(() => readActiveWorkspaceId() ?? "");
  const selectedWorkspaceId = routeWorkspaceId || legacySelectedWorkspaceId;
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? (selectedWorkspaceId ? null : workspaces[0] ?? null),
    [selectedWorkspaceId, workspaces],
  );
  // Workspace-scoped API calls (sessions, events, activate, opencode/*) must
  // hit the worker that owns the workspace, not the user's local server. The
  // single source of truth for that routing is `resolveWorkspaceEndpoint`.
  //
  // We read the latest local server's baseUrl/token through a ref so the
  // `endpointForWorkspace` callback stays permanently stable. Otherwise it
  // would change on every `setBaseUrl`/`setToken`, which used to cascade up
  // through `loadWorkspaceSessionsInBackground` and `refreshRouteState` and
  // produce a tight render-refresh-setWorkspaces loop.
  const localServerRef = useRef<{ baseUrl: string; token: string; hostToken: string }>({
    baseUrl: "",
    token: "",
    hostToken: "",
  });
  useEffect(() => {
    localServerRef.current = { ...localServerRef.current, baseUrl, token };
  }, [baseUrl, token]);
  const endpointForWorkspace = useCallback(
    (workspace: RouteWorkspace | null | undefined): ResolvedWorkspaceEndpoint | null =>
      resolveWorkspaceEndpoint(workspace, localServerRef.current),
    [],
  );

  // The canonical route owns workspace selection. Session rows, search,
  // external controls, and task creation can all navigate directly without
  // passing through the project-row handler, so synchronizing only inside
  // individual click handlers leaves Electron and the active engine pointed
  // at a different workspace than the visible conversation.
  useEffect(() => {
    if (loading || !selectedWorkspace) return;
    const workspaceId = selectedWorkspace.id.trim();
    if (!workspaceId) return;

    writeActiveWorkspaceId(workspaceId);
    const endpoint = endpointForWorkspace(selectedWorkspace);
    if (endpoint) {
      void endpoint.client.activateWorkspace(endpoint.workspaceId, { persist: true }).catch(() => undefined);
    }
    if (!isDesktopRuntime()) return;
    void workspaceSetSelected(workspaceId)
      .then(() => workspaceSetRuntimeActive(workspaceId))
      .catch(() => undefined);
  }, [endpointForWorkspace, loading, selectedWorkspace]);

  const refreshInFlightRef = useRef(false);
  const refreshEpochRef = useRef(0);
  const workContextRef = useRef(workContextId);
  const workspacesRef = useRef<RouteWorkspace[]>([]);
  const remoteWorkspaceCheckRunRef = useRef<Record<string, string>>({});
  const remoteWorkspaceCheckRunCounterRef = useRef(0);
  const sessionsByWorkspaceIdRef = useRef<Record<string, RouteSession[]>>(sessionsByWorkspaceId);
  const pendingCreatedSessionIdsRef = useRef<Record<string, Record<string, number>>>({});
  const startupRetryTimerRef = useRef<number | null>(null);
  const [retryingWorkspaceIds, setRetryingWorkspaceIds] = useState<string[]>([]);
  const launchActivatedWorkspaceIdsRef = useRef(new Set<string>());
  const reconnectAttemptedWorkspaceIdRef = useRef("");
  const backgroundSessionLoadInFlight = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    workContextRef.current = workContextId;
    refreshEpochRef.current += 1;
    refreshInFlightRef.current = false;
    setLoading(true);
    setRouteError(null);
    workspacesRef.current = [];
    const cachedSessions = readSessionDirectoryCache();
    sessionsByWorkspaceIdRef.current = cachedSessions;
    setWorkspaces([]);
    setSessionsByWorkspaceId(cachedSessions);
    setErrorsByWorkspaceId({});
    setRetryingWorkspaceIds([]);
    setLegacySelectedWorkspaceId("");
  }, [workContextId]);
  const rememberPendingCreatedSession = useCallback((workspaceId: string, sessionId: string) => {
    const id = sessionId.trim();
    if (!workspaceId || !id) return;
    pendingCreatedSessionIdsRef.current[workspaceId] = {
      ...(pendingCreatedSessionIdsRef.current[workspaceId] ?? {}),
      [id]: Date.now(),
    };
  }, []);
  const mergeFetchedSessionsWithPending = useCallback((workspaceId: string, fetched: RouteSession[], current: RouteSession[]) => {
    const pending = pendingCreatedSessionIdsRef.current[workspaceId];
    if (!pending) return fetched;
    const reconciled = reconcilePendingCreatedSessions(fetched, current, pending);
    if (Object.keys(reconciled.pending).length === 0) {
      delete pendingCreatedSessionIdsRef.current[workspaceId];
    } else {
      pendingCreatedSessionIdsRef.current[workspaceId] = reconciled.pending;
    }
    return reconciled.sessions;
  }, []);
  const loadWorkspaceSessionsInBackground = useCallback(
    async (workspaces: RouteWorkspace[]) => {
      const requestedContextId = workContextRef.current;
      const sessionLoadEpoch = refreshEpochRef.current;
      const isCurrentSessionLoad = () =>
        refreshEpochRef.current === sessionLoadEpoch &&
        workContextRef.current === requestedContextId;
      const MAX_ATTEMPTS = 6;
      const backoffMs = (attempt: number) => Math.min(500 * Math.pow(2, attempt), 4_000);

      const fetchOnce = async (workspace: RouteWorkspace, attempt: number): Promise<void> => {
        if (!isCurrentSessionLoad()) return;
        const isRemoteiPolloWorkWorkspace = workspace.workspaceType === "remote" && workspace.remoteType !== "opencode";
        const endpoint = endpointForWorkspace(workspace);
        if (!endpoint) {
          if (workspace.workspaceType === "remote") {
            const message = "Remote worker URL is missing. Edit connection and add a server URL.";
            setErrorsByWorkspaceId((current) => ({ ...current, [workspace.id]: message }));
            setWorkspaceConnectionOverrides((current) => ({
              ...current,
              [workspace.id]: {
                status: "error",
                message,
                checkedAt: Date.now(),
              },
            }));
            setRetryingWorkspaceIds((current) =>
              current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : current,
            );
          }
          return;
        }
        const startedAt = backgroundSessionLoadInFlight.current.get(workspace.id) ?? 0;
        if (startedAt && Date.now() - startedAt < 5_000) return;
        const requestStartedAt = Date.now();
        backgroundSessionLoadInFlight.current.set(workspace.id, requestStartedAt);
        if (isRemoteiPolloWorkWorkspace) {
          setWorkspaceConnectionOverrides((current) => ({
            ...current,
            [workspace.id]: {
              status: "connecting",
              message: t("workspace_list.loading_remote_tasks"),
              checkedAt: null,
            },
          }));
        }
        try {
          const response = await endpoint.client.listSessions(endpoint.workspaceId, { limit: 200 });
          const fetchedItems = response.items ?? [];
          const items = fetchedItems;
          if (!isCurrentSessionLoad()) return;
          setSessionsByWorkspaceId((current) => {
            const nextItems = mergeFetchedSessionsWithPending(workspace.id, items, current[workspace.id] ?? []);
            const next = { ...current, [workspace.id]: nextItems };
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
          setErrorsByWorkspaceId((current) => ({ ...current, [workspace.id]: null }));
          setWorkspaceConnectionOverrides((current) => {
            if (isRemoteiPolloWorkWorkspace) {
              return {
                ...current,
                [workspace.id]: {
                  status: "connected",
                  message: items.length > 0
                    ? t("workspace_list.connected_loaded_tasks", { count: items.length })
                    : t("workspace.connected_no_tasks"),
                  checkedAt: Date.now(),
                },
              };
            }
            if (current[workspace.id]?.status !== "error") return current;
            const next = { ...current };
            delete next[workspace.id];
            return next;
          });
          setRetryingWorkspaceIds((current) =>
            current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : current,
          );
          // When a workspace returns zero sessions during the initial batch
          // load, OpenCode may still be warming up its index.  Schedule a
          // single delayed retry so the sidebar doesn't stay permanently
          // empty while the managed engine finishes starting.
          if (items.length === 0 && attempt === 0) {
            window.setTimeout(() => {
              if (!isCurrentSessionLoad()) return;
              if (backgroundSessionLoadInFlight.current.get(workspace.id)) return;
              backgroundSessionLoadInFlight.current.delete(workspace.id);
              void fetchOnce(workspace, 1);
            }, 3_000);
          }
        } catch (error) {
          if (!isCurrentSessionLoad()) return;
          const message = error instanceof Error ? error.message : t("app.unknown_error");
          // The first cold call to OpenCode's /session endpoint often hits
          // the 12s server timeout while the daemon finishes warming up
          // its index. Retry silently with backoff until we get a response
          // or run out of attempts — the sidebar keeps its "loading" state
          // in the meantime instead of flashing "error" next to the
          // workspace name.
          if (attempt + 1 < MAX_ATTEMPTS && isTransientStartupError(message)) {
            if (backgroundSessionLoadInFlight.current.get(workspace.id) === requestStartedAt) {
              backgroundSessionLoadInFlight.current.delete(workspace.id);
            }
            await new Promise((r) => window.setTimeout(r, backoffMs(attempt)));
            await fetchOnce(workspace, attempt + 1);
            return;
          }
          // Final failure: keep local workspace startup quiet, but give
          // remote workers a precise endpoint/token/workspace diagnostic.
          if (workspace.workspaceType === "remote") {
            const connectionState = await diagnoseRemoteWorkspaceTaskLoadFailure(workspace, message);
            if (!isCurrentSessionLoad()) return;
            setErrorsByWorkspaceId((current) => ({
              ...current,
              [workspace.id]: connectionState.message ?? "Remote worker connection failed.",
            }));
            setWorkspaceConnectionOverrides((current) => {
              return {
                ...current,
                [workspace.id]: connectionState,
              };
            });
          }
          setRetryingWorkspaceIds((current) =>
            current.includes(workspace.id) ? current.filter((id) => id !== workspace.id) : current,
          );
        } finally {
          if (backgroundSessionLoadInFlight.current.get(workspace.id) === requestStartedAt) {
            backgroundSessionLoadInFlight.current.delete(workspace.id);
          }
        }
      };

      await Promise.all(workspaces.map((workspace) => fetchOnce(workspace, 0)));
    },
    [endpointForWorkspace, mergeFetchedSessionsWithPending],
  );

  const refreshRouteState = useCallback(async () => {
    // Dedupe: if a refresh is already running, skip this call. Fast workspace
    // switches used to fire 5-6 overlapping refreshRouteState() calls which
    // each fetched workspaces + sessions for every workspace. That workload
    // multiplied quickly on the event loop and caused the UI to freeze.
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const refreshEpoch = ++refreshEpochRef.current;
    const isCurrentRefresh = () =>
      refreshEpochRef.current === refreshEpoch && workContextRef.current === workContextId;
    const reportStartupTiming = !STARTUP_ROUTE_TIMING_REPORTED;
    const logStartupTiming = (...args: unknown[]) => {
      if (reportStartupTiming) console.info(...args);
    };
    const refreshStartedAt = Date.now();
    logStartupTiming("[startup] session route refresh started");
    const requestedContextId = workContextId;
    const requestedRouteSelection = routeSelectionRef.current;
    setLoading(true);
    setRouteError(null);
    let desktopList: WorkspaceList | null = null;
    let desktopWorkspaces = workspacesRef.current;
    let routeReadyAfterRefresh = true;
    try {
      if (isDesktopRuntime()) {
        const workspaceBootstrapStartedAt = Date.now();
        try {
          desktopList = await workspaceBootstrap() as WorkspaceList;
          desktopWorkspaces = filterWorkspacesForWorkContext(
            (desktopList.workspaces ?? []).map(mapDesktopWorkspace),
            requestedContextId,
          );
        } catch (error) {
          const message = describeRouteError(error);
          console.error("[session-route] workspaceBootstrap failed", error);
          recordInspectorEvent("route.workspace_bootstrap.error", {
            route: "session",
            message,
            preservedWorkspaceCount: workspacesRef.current.length,
          });
          desktopWorkspaces = workspacesRef.current;
        } finally {
          logStartupTiming(`[startup] workspace list loaded in ${Date.now() - workspaceBootstrapStartedAt}ms`);
        }
      }

      if (!isCurrentRefresh()) return;

      const connectionStartedAt = Date.now();
      const { normalizedBaseUrl, resolvedToken, resolvedHostToken, hostInfo } = await resolveiPolloWorkConnection();
      if (!isCurrentRefresh()) return;
      logStartupTiming(`[startup] local server connection resolved in ${Date.now() - connectionStartedAt}ms`);
      onHostInfo(hostInfo);
      if (!normalizedBaseUrl || !resolvedToken) {
        // Keep `localServerRef` in lockstep with the disconnected state.
        // Otherwise a previously-cached baseUrl/token would still resolve a
        // (now invalid) endpoint for any callback that consults the ref.
        localServerRef.current = { baseUrl: "", token: "", hostToken: "" };
        setClient(null);
        setBaseUrl("");
        setToken("");
        setWorkspaces(desktopWorkspaces);
        const cachedSessions = readSessionDirectoryCache();
        sessionsByWorkspaceIdRef.current = cachedSessions;
        setSessionsByWorkspaceId(cachedSessions);
        setErrorsByWorkspaceId({});
        setLegacySelectedWorkspaceId(resolveWorkspaceListSelectedId(desktopList) || desktopWorkspaces[0]?.id || "");
        return;
      }

      // Update the local-server ref synchronously, BEFORE we kick off any
      // workspace-scoped requests below. `endpointForWorkspace` reads from
      // this ref synchronously; the `useEffect` that mirrors `[baseUrl,
      // token]` into the ref doesn't run until after the next React commit,
      // which is too late for the `activateWorkspace` and
      // `loadWorkspaceSessionsInBackground` calls that fire later in this
      // function. Stale ref => `resolveWorkspaceEndpoint` returns null for
      // local workspaces => sidebar gets stuck in "loading" forever.
      localServerRef.current = {
        baseUrl: normalizedBaseUrl,
        token: resolvedToken,
        hostToken: resolvedHostToken,
      };

      const ipolloworkClient = createiPolloWorkServerClient({
        baseUrl: normalizedBaseUrl,
        token: resolvedToken,
        hostToken: resolvedHostToken || undefined,
      });
      const serverWorkspacesStartedAt = Date.now();
      const list = await ipolloworkClient.listWorkspaces();
      logStartupTiming(`[startup] server workspaces loaded in ${Date.now() - serverWorkspacesStartedAt}ms`);
      const persistedActiveId = readActiveWorkspaceId();
      const nextWorkspaces = orderRouteWorkspaces(
        filterWorkspacesForWorkContext(
          mergeRouteWorkspaces(list.items, desktopWorkspaces),
          requestedContextId,
        ),
        workspacesRef.current.map((workspace) => workspace.id),
      );

      if (!isCurrentRefresh()) return;

      // Preserve any sessions we already have cached so switching routes
      // doesn't erase the sidebar while we refetch. Never carry a local
      // session across workspace roots, even if a fast context switch races
      // with a late React state commit from the previous route.
      const alreadyLoadedWorkspaceIds = new Set(Object.keys(sessionsByWorkspaceIdRef.current));
      const cachedEntries = nextWorkspaces.map((workspace) => {
        const cachedSessions = sessionsByWorkspaceIdRef.current[workspace.id] ?? [];
        const sessions = cachedSessions;
        return { workspaceId: workspace.id, sessions };
      });
      // Prefer, in order: the URL-selected workspace (if it owns the session),
      // the user's last-active workspace from localStorage, the desktop's
      // activeId, the server's activeId, then the first known workspace.
      let nextWorkspaceId = resolveKnownWorkspaceId(nextWorkspaces, [
        requestedRouteSelection.workspaceId,
        persistedActiveId,
        resolveWorkspaceListSelectedId(desktopList),
        list.activeId,
        nextWorkspaces[0]?.id,
      ]);
      if (requestedRouteSelection.sessionId) {
        const match = cachedEntries.find((entry) =>
          entry.sessions.some((session) => session?.id === requestedRouteSelection.sessionId),
        );
        if (match?.workspaceId) nextWorkspaceId = match.workspaceId;
      }

      setClient(ipolloworkClient);
      setBaseUrl(normalizedBaseUrl);
      setToken(resolvedToken);
      setWorkspaces(nextWorkspaces);
      const nextSessionsByWorkspaceId = Object.fromEntries(cachedEntries.map((entry) => [entry.workspaceId, entry.sessions]));
      sessionsByWorkspaceIdRef.current = nextSessionsByWorkspaceId;
      setSessionsByWorkspaceId(nextSessionsByWorkspaceId);
      setErrorsByWorkspaceId((previous) => {
        const next: Record<string, string | null> = {};
        for (const workspace of nextWorkspaces) {
          next[workspace.id] = previous[workspace.id] ?? null;
        }
        return next;
      });
      const selectedEntry = cachedEntries.find((entry) => entry.workspaceId === nextWorkspaceId);
      setRetryingWorkspaceIds(
        selectedEntry && selectedEntry.sessions.length === 0 && !alreadyLoadedWorkspaceIds.has(selectedEntry.workspaceId)
          ? [selectedEntry.workspaceId]
          : [],
      );
      setLegacySelectedWorkspaceId(nextWorkspaceId);
      writeActiveWorkspaceId(nextWorkspaceId || null);
      // Session surface is canonical server metadata. Populate the small
      // in-memory icon cache from that one source; no browser persistence or
      // legacy path probing is involved.
      void Promise.all(nextWorkspaces.map(async (workspace) => {
        const endpoint = endpointForWorkspace(workspace);
        if (!endpoint) return [];
        try {
          return (await endpoint.client.listTemplateSessions(endpoint.workspaceId)).items;
        } catch {
          return [];
        }
      })).then((results) => {
        if (isCurrentRefresh()) setTemplateSessionTypes(results.flat());
      });
      // Mark the chosen workspace as active on the server so that the
      // OpenCode engine bound to it re-reads opencode.jsonc and applies
      // permissions. Fire-and-forget; the route is idempotent and any
      // transport failure is non-fatal. See issue #870.
      if (nextWorkspaceId && list.activeId !== nextWorkspaceId && !launchActivatedWorkspaceIdsRef.current.has(nextWorkspaceId)) {
        launchActivatedWorkspaceIdsRef.current.add(nextWorkspaceId);
        const nextWorkspace = nextWorkspaces.find((workspace) => workspace.id === nextWorkspaceId) ?? null;
        const nextEndpoint = endpointForWorkspace(nextWorkspace);
        if (nextEndpoint) {
          void nextEndpoint.client.activateWorkspace(nextEndpoint.workspaceId).catch(() => undefined);
        }
      }
      recordInspectorEvent("route.refresh.complete", {
        workspaces: nextWorkspaces.length,
        selectedWorkspaceId: nextWorkspaceId,
        errors: {},
      });

      // Session directories are metadata-only and load independently from the
      // route shell. Do not hold the whole workspace UI behind this request:
      // the user can start a new task immediately while the selected project's
      // existing task list fills in.
      const initialLoads = partitionInitialWorkspaceLoads(
        nextWorkspaces,
        nextWorkspaceId,
        alreadyLoadedWorkspaceIds,
      );
      const selectedSessionsStartedAt = Date.now();
      const selectedSessionsLoad = initialLoads.selected.length > 0
        ? loadWorkspaceSessionsInBackground(initialLoads.selected).then(() => {
            logStartupTiming(`[startup] selected workspace sessions loaded in ${Date.now() - selectedSessionsStartedAt}ms`, {
              workspaceId: nextWorkspaceId,
            });
          })
        : Promise.resolve();
      if (initialLoads.deferred.length > 0) {
        // Keep cold runtimes for background projects from competing with the
        // selected project's task directory. Message history remains lazy.
        void selectedSessionsLoad.then(async () => {
          for (const workspace of initialLoads.deferred) {
            await loadWorkspaceSessionsInBackground([workspace]);
          }
        });
      }
    } catch (error) {
      if (!isCurrentRefresh()) return;
      const message = describeRouteError(error);
      console.error("[session-route] refreshRouteState failed", error);
      recordInspectorEvent("route.refresh.error", {
        route: "session",
        message,
        preservedWorkspaceCount: desktopWorkspaces.length,
      });
      setRouteError(message);
      if (desktopWorkspaces.length > 0) {
        setWorkspaces(desktopWorkspaces);
        setLegacySelectedWorkspaceId((current) =>
          current || resolveWorkspaceListSelectedId(desktopList) || desktopWorkspaces[0]?.id || "",
        );
      }
    } finally {
      if (isCurrentRefresh()) {
        setLoading(false);
        await waitForCommittedRouteState();
        if (isCurrentRefresh()) {
          finishWorkContextSwitch(requestedContextId);
        }
      }
      if (refreshEpochRef.current === refreshEpoch) {
        refreshInFlightRef.current = false;
      }
      // Tell the boot overlay the first route data load has completed so
      // the overlay dismisses after BOTH the desktop boot and the workspace
      // list/sessions are ready.
      if (routeReadyAfterRefresh && isCurrentRefresh()) {
        markBootRouteReady();
      }
      logStartupTiming(`[startup] session route refresh completed in ${Date.now() - refreshStartedAt}ms`);
      STARTUP_ROUTE_TIMING_REPORTED = true;
    }
  }, [loadWorkspaceSessionsInBackground, markBootRouteReady, workContextId]);
  const handleRuntimeSessionUpdated = useCallback((update: { sessionId: string; info: Record<string, unknown> }) => {
    if (!selectedWorkspaceId) return;
    setSessionsByWorkspaceId((current) => {
      const list = current[selectedWorkspaceId] ?? [];
      const index = list.findIndex((session) => session?.id === update.sessionId);
      if (index < 0) return current;
      const nextSession = { ...list[index], ...update.info, id: update.sessionId };
      if (JSON.stringify(nextSession) === JSON.stringify(list[index])) return current;
      const nextList = [...list];
      nextList[index] = nextSession;
      const next = { ...current, [selectedWorkspaceId]: nextList };
      sessionsByWorkspaceIdRef.current = next;
      return next;
    });
  }, [selectedWorkspaceId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    setWorkspaceConnectionOverrides((current) => {
      let changed = false;
      const next: Record<string, WorkspaceConnectionState> = {};
      for (const [workspaceId, state] of Object.entries(current)) {
        if (activeWorkspaceIds.has(workspaceId)) {
          next[workspaceId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workspaces]);

  useEffect(() => {
    sessionsByWorkspaceIdRef.current = sessionsByWorkspaceId;
    if (workspaces.length === 0) return;
    const visibleWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    writeSessionDirectoryCache(Object.fromEntries(
      Object.entries(sessionsByWorkspaceId).filter(([workspaceId]) => visibleWorkspaceIds.has(workspaceId)),
    ));
  }, [sessionsByWorkspaceId, workspaces]);

  useEffect(() => {
    if (loading || !selectedWorkspace) return;
    let disposed = false;
    let syncInFlight = false;
    const syncSelectedWorkspaceSessions = async () => {
      if (disposed || syncInFlight || document.visibilityState === "hidden") return;
      syncInFlight = true;
      try {
        await loadWorkspaceSessionsInBackground([selectedWorkspace]);
      } finally {
        syncInFlight = false;
      }
    };
    void syncSelectedWorkspaceSessions();
    const interval = window.setInterval(
      () => void syncSelectedWorkspaceSessions(),
      SELECTED_WORKSPACE_SESSION_SYNC_INTERVAL_MS,
    );
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [loadWorkspaceSessionsInBackground, loading, selectedWorkspace]);

  const handleRemoteWorkspaceConnectionSaved = useCallback(
    async (workspaceId: string) => {
      delete remoteWorkspaceCheckRunRef.current[workspaceId];
      setWorkspaceConnectionOverrides((current) => {
        const next = { ...current };
        delete next[workspaceId];
        return next;
      });
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      setRetryingWorkspaceIds((current) => current.filter((id) => id !== workspaceId));
      await refreshRouteState();
    },
    [refreshRouteState],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (cancelled) return;
        await refreshRouteState();
      } finally {
        if (cancelled) return;
      }
    })();

    const handleSettingsChange = () => {
      onServerSettingsChanged();
      // Self-heal: if the previous refresh got stuck mid-flight (e.g. macOS
      // backgrounded the webview and never let a fetch resolve), clear the
      // guard so a re-entry after resume actually goes through.
      refreshEpochRef.current += 1;
      refreshInFlightRef.current = false;
      void refreshRouteState();
    };
    window.addEventListener("ipollowork-server-settings-changed", handleSettingsChange);

    const handleDesktopResume = () => {
      // Invalidate every request started before suspend. A late completion
      // must not overwrite the freshly recovered workspace/session state.
      refreshEpochRef.current += 1;
      refreshInFlightRef.current = false;
      backgroundSessionLoadInFlight.current.clear();
      setRetryingWorkspaceIds([]);
      void refreshRouteState();
    };
    window.addEventListener(desktopResumeEvent, handleDesktopResume);
    window.addEventListener("online", handleDesktopResume);

    // Also retry on visibility flip independently — even when nobody else
    // dispatches the settings event.
    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      refreshEpochRef.current += 1;
      refreshInFlightRef.current = false;
      void refreshRouteState();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      cancelled = true;
      if (startupRetryTimerRef.current !== null) {
        window.clearTimeout(startupRetryTimerRef.current);
        startupRetryTimerRef.current = null;
      }
      window.removeEventListener("ipollowork-server-settings-changed", handleSettingsChange);
      window.removeEventListener(desktopResumeEvent, handleDesktopResume);
      window.removeEventListener("online", handleDesktopResume);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [refreshRouteState]);

  // Inspector wiring: publish the route's current state so an external
  // operator (or an AI driver using browser tools) can call
  // `window.__ipollowork.snapshot()` or `window.__ipollowork.slice("route")` and
  // see workspaces / sessions / connection info without walking the DOM.
  useEffect(() => {
    const dispose = publishInspectorSlice("route", () => ({
      loading,
      retryingWorkspaceIds,
      baseUrl,
      tokenPresent: token.length > 0,
      connected: Boolean(client),
      routeError,
      selectedSessionId,
      selectedWorkspaceId,
      persistedActiveWorkspaceId: readActiveWorkspaceId(),
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        displayNameResolved: workspace.displayNameResolved,
        workspaceType: workspace.workspaceType,
        path: workspace.path,
        sessionCount: (sessionsByWorkspaceId[workspace.id] ?? []).length,
        loading: retryingWorkspaceIds.includes(workspace.id),
        error: errorsByWorkspaceId[workspace.id] ?? null,
      })),
      sessionsByWorkspaceId: Object.fromEntries(
        Object.entries(sessionsByWorkspaceId).map(([wsId, items]) => [
          wsId,
          (items ?? []).map((session) => ({
            id: session?.id ?? null,
            title: session?.title ?? null,
            directory: session?.directory ?? null,
          })),
        ]),
      ),
    }));
    return dispose;
  }, [
    baseUrl,
    client,
    errorsByWorkspaceId,
    loading,
    retryingWorkspaceIds,
    selectedSessionId,
    selectedWorkspaceId,
    routeError,
    sessionsByWorkspaceId,
    token,
    workspaces,
  ]);

  // Keep the startup route workspace-scoped. A session is selected only after
  // the user clicks it or the startup new-conversation flow creates one.
  useEffect(() => {
    if (loading) return;
    if (routeWorkspaceId && workspaces.length > 0 && !workspaces.some((workspace) => workspace.id === routeWorkspaceId)) {
      const fallbackWorkspaceId = workspaces.some((workspace) => workspace.id === legacySelectedWorkspaceId)
        ? legacySelectedWorkspaceId
        : workspaces[0]?.id || "";
      if (fallbackWorkspaceId) {
        // A route from the previous work context can never own a session in
        // the new one. Drop both stale identifiers atomically so a context
        // switch cannot flash a false "not found" state or carry the old
        // conversation id into the canonical workspace.
        navigateToWorkspaceSession(fallbackWorkspaceId, null, { replace: true });
      }
      return;
    }
    if (!routeWorkspaceId && selectedWorkspaceId) {
      navigateToWorkspaceSession(selectedWorkspaceId, null, { replace: true });
    }
  }, [
    loading,
    legacySelectedWorkspaceId,
    navigateToWorkspaceSession,
    routeWorkspaceId,
    selectedWorkspaceId,
    workspaces,
  ]);

  // NOTE: Blueprint seeding was removed from the route.
  // It was firing `materializeBlueprintSessions` + a session re-fetch on every
  // workspace change, which cascaded setState updates and froze the UI after
  // a few rapid switches. Empty workspaces now stay session-free until the
  // user submits the project starter or clicks "New task". Seeding can be
  // reintroduced later as a one-shot triggered from a button or onboarding,
  // not from the route effect loop.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (loading) return;
    if (client) {
      reconnectAttemptedWorkspaceIdRef.current = "";
      return;
    }
    if (!selectedWorkspace || selectedWorkspace.workspaceType !== "local") return;
    const workspaceId = selectedWorkspace.id?.trim() ?? "";
    if (!workspaceId || reconnectAttemptedWorkspaceIdRef.current === workspaceId) return;
    reconnectAttemptedWorkspaceIdRef.current = workspaceId;

    void ensureDesktopLocaliPolloWorkConnection({
      route: "session",
      workspace: selectedWorkspace,
      allWorkspaces: workspaces,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : describeRouteError(error);
      setRouteError(message);
    });
  }, [client, loading, selectedWorkspace, workspaces]);

  const selectedWorkspaceRoot = selectedWorkspace?.path?.trim() || "";
  // Single source of truth for the selected workspace's server URL/token/id.
  // For remote workspaces this is the worker that owns the workspace; for
  // local workspaces it's the user's local iPolloWork server.
  const selectedWorkspaceEndpoint = useMemo(
    () => resolveWorkspaceEndpoint(selectedWorkspace, {
      baseUrl,
      token,
      hostToken: localServerRef.current.hostToken,
    }),
    [baseUrl, selectedWorkspace, token],
  );
  const selectedWorkspaceServerToken = selectedWorkspaceEndpoint?.token ?? "";
  const opencodeBaseUrl = selectedWorkspaceEndpoint?.opencodeBaseUrl ?? "";
  const selectedWorkspaceIsLoading = retryingWorkspaceIds.includes(selectedWorkspaceId);
  const selectedWorkspaceError = errorsByWorkspaceId[selectedWorkspaceId] ?? null;
  const selectedWorkspaceUsesOpenCode =
    (selectedWorkspace?.engineId?.trim() || DEFAULT_ENGINE_ID) === DEFAULT_ENGINE_ID;
  const selectedSessionKnown = Boolean(
    selectedSessionId &&
      (sessionsByWorkspaceId[selectedWorkspaceId] ?? []).some((session) => session?.id === selectedSessionId),
  );
  const routeNotFoundMessage = (() => {
    if (loading) return null;
    if (routeWorkspaceId && !selectedWorkspace) {
      // A canonical workspace is already available, so the redirect effect
      // above will repair this stale cross-context URL. This is transition
      // state, not a user-facing missing-workspace error.
      if (workspaces.length > 0) return null;
      return "Workspace was not found. Select a new workspace from the sidebar.";
    }
    if (selectedSessionId && !selectedWorkspaceIsLoading && !selectedSessionKnown) {
      return "Session was not found. Select a new session from the sidebar.";
    }
    return null;
  })();
  // Boot-level loading blocks the whole UI. Session-list retries only fill the
  // sidebar; they must not gate the composer/New task.
  const effectiveLoading = loading;

  const opencodeClient = useMemo(
    () =>
      selectedWorkspaceUsesOpenCode && opencodeBaseUrl && selectedWorkspaceServerToken && !selectedWorkspaceError
        ? createClient(opencodeBaseUrl, selectedWorkspaceRoot || undefined, {
            token: selectedWorkspaceServerToken,
            mode: "ipollowork",
          })
        : null,
    [opencodeBaseUrl, selectedWorkspaceError, selectedWorkspaceRoot, selectedWorkspaceServerToken, selectedWorkspaceUsesOpenCode],
  );
  const runRemoteWorkspaceConnectionCheck = useCallback(
    async (workspaceId: string, mode: "test" | "recover") => {
      const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
      if (!workspace || workspace.workspaceType !== "remote") return false;
      const connectionKey = getRemoteWorkspaceConnectionKey(workspace);
      remoteWorkspaceCheckRunCounterRef.current += 1;
      const runId = String(remoteWorkspaceCheckRunCounterRef.current);
      remoteWorkspaceCheckRunRef.current[workspaceId] = runId;

      setWorkspaceConnectionOverrides((current) => ({
        ...current,
        [workspaceId]: {
          status: "connecting",
          message: t("config.testing_connection"),
          checkedAt: null,
        },
      }));

      const result = await testRemoteWorkspaceConnection(workspace);
      const currentWorkspace = workspacesRef.current.find((item) => item.id === workspaceId);
      if (
        remoteWorkspaceCheckRunRef.current[workspaceId] !== runId ||
        !currentWorkspace ||
        getRemoteWorkspaceConnectionKey(currentWorkspace) !== connectionKey
      ) {
        if (remoteWorkspaceCheckRunRef.current[workspaceId] === runId) {
          delete remoteWorkspaceCheckRunRef.current[workspaceId];
        }
        return false;
      }
      setWorkspaceConnectionOverrides((current) => ({
        ...current,
        [workspaceId]: result.state,
      }));

      if (!result.ok) {
        setErrorsByWorkspaceId((current) => ({
          ...current,
          [workspaceId]: result.state.message ?? "Remote worker connection failed.",
        }));
        if (remoteWorkspaceCheckRunRef.current[workspaceId] === runId) {
          delete remoteWorkspaceCheckRunRef.current[workspaceId];
        }
        return false;
      }

      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      setRetryingWorkspaceIds((current) => current.filter((id) => id !== workspaceId));
      if (mode === "recover") {
        await refreshRouteState();
      }
      if (remoteWorkspaceCheckRunRef.current[workspaceId] === runId) {
        delete remoteWorkspaceCheckRunRef.current[workspaceId];
      }
      return true;
    },
    [refreshRouteState],
  );

  return {
    navigateToWorkspaceSession,
    routeWorkspaceId,
    selectedSessionId,
    loading,
    effectiveLoading,
    client,
    baseUrl,
    token,
    workspaces,
    setWorkspaces,
    workspacesRef,
    sessionsByWorkspaceId,
    setSessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    errorsByWorkspaceId,
    setErrorsByWorkspaceId,
    workspaceConnectionOverrides,
    routeError,
    setRouteError,
    legacySelectedWorkspaceId,
    setLegacySelectedWorkspaceId,
    retryingWorkspaceIds,
    setRetryingWorkspaceIds,
    refreshInFlightRef,
    startupRetryTimerRef,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedWorkspaceRoot,
    selectedWorkspaceEndpoint,
    selectedWorkspaceServerToken,
    opencodeBaseUrl,
    opencodeClient,
    selectedWorkspaceIsLoading,
    selectedWorkspaceError,
    selectedSessionKnown,
    routeNotFoundMessage,
    endpointForWorkspace,
    refreshRouteState,
    loadWorkspaceSessionsInBackground,
    rememberPendingCreatedSession,
    handleRuntimeSessionUpdated,
    handleRemoteWorkspaceConnectionSaved,
    runRemoteWorkspaceConnectionCheck,
  };
}
