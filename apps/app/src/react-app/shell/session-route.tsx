/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { UIMessage } from "ai";
import { toast } from "@/components/ui/sonner";
import type { PptxCompatibility, TemplateCategory, TemplateSessionSnapshot } from "@ipollowork/types/templates";
import {
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEFAULT_ENGINE_ID,
  type BuiltInWorkspaceEngineId,
} from "@ipollowork/types/workspace";

import { captureAnalyticsEvent, markTaskRunStart } from "@/app/lib/analytics";
import { createClient } from "@/app/lib/opencode";
import {
  PERSONAL_WORK_CONTEXT_ID,
  readActiveWorkContextId,
  rememberProjectForWorkContext,
  type WorkContextId,
  workContextChangedEvent,
} from "@/app/lib/work-context";
import { trackSessionActive, trackTaskStarted } from "@/app/lib/den-telemetry";
import { buildDiagnosticsBundleJson } from "@/app/lib/diagnostics-bundle";
import { downloadTextAsFile } from "@/app/lib/download";
import {
  isDefaultSessionTitle,
  sessionTitleFromFirstPrompt,
} from "@/app/lib/session-title";
import {
  resolveWorkspaceEndpoint,
  workspaceServerId,
} from "@/app/lib/workspace-endpoint";
import { buildiPolloWorkEnvRuntimeKey } from "@/app/lib/ipollowork-env-runtime";
import {
  revealDesktopItemInDir,
  workspaceCreate,
  workspaceForget,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  workspaceUpdateDisplayName,
  type iPolloWorkServerInfo,
} from "@/app/lib/desktop";
import type {
  ComposerDraft,
  ModelRef,
  PromptDispatchOptions,
  SlashCommandOption,
  WorkspaceConnectionState,
  ProviderListItem,
  ProviderListResponse,
} from "@/app/types";
import {
  getWorkspaceTaskLoadErrorDisplay,
  isDesktopRuntime,
  isSandboxWorkspace,
  normalizeDirectoryPath,
  resolveModelDisplayName,
  safeStringify,
} from "@/app/utils";
import { currentLocale, t } from "@/i18n";
import {
  buildTaskPaletteSessionOptions,
  describeWorkspaceUnavailableTitle,
  describeRouteError,
  getSessionStatus,
  isActiveSessionStatus,
  isSidecarLaunchBlockedError,
  isTransientStartupError,
  toProjectSessionLists,
  userVisibleSessionsByWorkspaceId,
} from "@/react-app/shell/route-workspaces";
import {
  getEnginePreferences,
  updateModelPreferences,
  updateEnginePreferences,
  useLocal,
} from "@/react-app/kernel/local-provider";
import { SessionPage } from "@/react-app/domains/session/chat/session-page";
import { isDesktopProviderBlocked, DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID } from "@/app/cloud/desktop-app-restrictions";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { ReactSessionRuntime } from "@/react-app/domains/session/sync/runtime-sync";
import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store";
import { buildiPolloWorkEnvSystemContext } from "@/react-app/domains/session/sync/env-context";
import {
  applySessionRevert,
  beginOptimisticSessionPrompt,
  destroyWorkspaceSessionResources,
  rollbackOptimisticSessionPrompt,
} from "@/react-app/domains/session/sync/session-sync";
import { attachmentRequiresNativeModelSupport } from "@/react-app/domains/session/sync/attachment-support";
import {
  designHtmlThemeSystemContext,
  type DesignAiSelectionContext,
} from "@ipollowork/design-studio";
import { useDesignAiSelectionStore } from "@/react-app/domains/session/design/design-ai-selection-store";
import { readAppliedDesignSystemId } from "@/react-app/domains/session/design/design-system-theme-contract";
import { templateAuthoringKickoff, templateAuthoringSystemContext } from "@/react-app/domains/session/templates/template-authoring";
import {
  conversationArtifactSessionId,
  conversationTemplateBrief,
  inferConversationTemplateIntents,
  selectConversationTemplate,
  templateBriefPrompt,
} from "@/react-app/domains/session/templates/template-brief";
import { useSessionInteractions } from "@/react-app/domains/session/sync/use-session-interactions";
import {
  modelSupportsAttachments,
  useModelBehavior,
} from "@/react-app/domains/session/surface/use-model-behavior";
import { tokenStarModelSupportsEffort } from "@/app/lib/model-behavior";
import { useSessionFindStore } from "@/react-app/domains/session/surface/find-store";
import { useModelPicker } from "@/react-app/domains/session/modals/use-model-picker";
import { CreateRemoteWorkspaceModal } from "@/react-app/domains/workspace/create-remote-workspace-modal";
import { useSessionProviderAuth } from "@/react-app/domains/connections/provider-auth/use-session-provider-auth";
import { providerEngineAdapters } from "@/react-app/domains/connections/provider-auth/provider-engine-adapter";
import { selectSharedProviderWorkspace } from "@/react-app/domains/connections/provider-auth/shared-provider-workspace";
import { useMcpConnectedCount } from "@/react-app/domains/connections/use-mcp-connected-count";
import { useSessionMcpMaintenance } from "@/react-app/domains/connections/use-session-mcp-maintenance";
import type { iPolloWorkSessionType, iPolloWorkTemplateId } from "@/react-app/domains/session/sidebar/app-sidebar-provider";
import { readSessionType, sessionTypeForTemplate, setSessionType } from "@/react-app/domains/session/sidebar/session-type";
import {
  shouldInjectVideoTaskContext,
  videoCompositionHasVoiceover,
  videoDeliveryRequirementsForPrompt,
  videoProjectEntryPath,
  videoTaskSystemContext,
} from "@/react-app/domains/session/video/video-project";
import { useRemoteWorkspaceConnectionEditor } from "@/react-app/domains/workspace/use-remote-workspace-connection-editor";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { IPolloWorkModelsStartupDialog } from "@/react-app/domains/cloud/ipollowork-models-startup-dialog";
import { IPOLLOWORK_MODEL_PREVIEWS } from "@/react-app/domains/cloud/ipollowork-models-promo";
import { FirstRunLoader } from "@/react-app/domains/onboarding/first-run-loader";
import { useiPolloWorkModelsStartupPromo } from "@/react-app/domains/cloud/use-ipollowork-models-startup-promo";
import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal";
import { CommandPalette, type PaletteItem, type SessionOption as PaletteSessionOption } from "./command-palette";
import { SessionSearchDialog } from "./session-search-dialog";
import type { SessionMessageFetcher } from "@/react-app/domains/session/search/session-search";
import {
  readActiveWorkspaceId,
  readLastSessionFor,
  readWorkspaceProjectDimension,
  writeActiveWorkspaceId,
  writeLastSessionFor,
} from "./session-memory";
import { saveSessionDraft } from "@/react-app/domains/session/sync/draft-store";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { useControlAction, type iPolloWorkControlAction } from "./control/control-provider";
import { useReactRenderWatchdog } from "./react-render-watchdog";

import { readDenSettings } from "@/app/lib/den";
import { denSessionUpdatedEvent } from "@/app/lib/den-session-events";

import { filterProviderList } from "@/app/utils/providers";
import { useReloadCoordinator } from "./reload-coordinator";
import { useShellShortcuts } from "./use-shell-shortcuts";
import { useEngineReload } from "./use-engine-reload";
import { useWorkspaceRouteState } from "./use-workspace-route-state";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import {
  forgetProjectBuilderSession,
  isProjectBuilderSession,
  markProjectBuilderSession,
  projectBuilderSessionId,
  scopeProjectBuilderDraft,
} from "@/react-app/domains/work/project-builder-session";
import { projectExecutionSystemContext } from "@ipollowork/types/work-items";
import { useSessionControlActions } from "@/react-app/domains/session/control/session-control-actions";
import type { ConversationStatus } from "@/react-app/domains/session/engine/conversation-engine";
import { conversationEngineAdapters } from "@/react-app/domains/session/engine/conversation-engines";
import { workspaceSessionRoute, workspaceSettingsRoute } from "./workspace-routes";
import { WorkspaceProvider } from "./workspace-provider";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { SettingsSurface } from "./settings-route";
import {
  ensureProviderListQuery,
  getSelectableChatModelSnapshot,
  mergeProviderListResponses,
  projectAccountProviderConnections,
  type ProviderListQueryInput,
  useMergedProviderListQuery,
  useProviderListQuery,
} from "@/react-app/infra/provider-list-query";
import { resolveEngineSelectableChatModel } from "@/react-app/infra/preferred-chat-model";
import {
  designSelectionContextsForDraft,
  draftToParts,
  persistedAttachmentInstruction,
  persistComposerAttachments,
  promptDesignSelectionContexts,
  responseLanguageSystemContext,
  serializeSDKError,
} from "./session-prompt";

function describeTaskCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (isSidecarLaunchBlockedError(message)) {
    return "Windows denied starting the OpenCode sidecar (spawn EPERM). Check whether antivirus, Controlled Folder Access, app permissions, or a quarantined opencode.exe is blocking iPolloWork, then retry or restart the app.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("connection") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("connection lost") ||
    lower.includes("internal_error") ||
    lower.includes("unexpected server error")
  ) {
    return "OpenCode is unavailable for this workspace. Retry once it restarts, or restart iPolloWork if the problem continues.";
  }
  return message;
}

function taskCreateUnavailableToastId(workspaceId: string) {
  return `opencode-unavailable:${workspaceId}`;
}

function templateCreateUnavailableToastId(workspaceId: string, templateId: string) {
  return `template-unavailable:${workspaceId}:${templateId}`;
}

function focusPromptSoon() {
  if (typeof window === "undefined") return;
  const focus = () => window.dispatchEvent(new Event("ipollowork:focusPrompt"));
  [0, 80, 240, 600].forEach((delay) => window.setTimeout(focus, delay));
}

// All workspace-scoped server URLs/clients/tokens come from
// `resolveWorkspaceEndpoint` in apps/app/src/app/lib/workspace-endpoint.ts.
// Don't compose `<baseUrl>/workspace/<id>` here.

// Module-scoped so the first-run loader survives route remounts during boot
// (component state would reset and flash the underlying page). Reset only on
// app relaunch, matching BOOT_STARTED in desktop-runtime-boot.ts.
let firstRunLoaderPhase: "unarmed" | "armed" | "done" = "unarmed";

type PendingInitialProjectTask = {
  workspaceId: string;
  sessionId: string | null;
  runtimeWorkspaceId: string | null;
  clientUserMessageId: string | null;
  draft: ComposerDraft;
};

export function SessionRoute() {
  const navigate = useNavigate();
  const denAuth = useDenAuth();
  const local = useLocal();
  const reloadCoordinator = useReloadCoordinator();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const [ipolloworkServerHostInfoState, setiPolloWorkServerHostInfoState] = useState<iPolloWorkServerInfo | null>(null);
  const [, setiPolloWorkServerSettingsVersion] = useState(0);
  const [activeWorkContextId, setActiveWorkContextId] = useState(() => readActiveWorkContextId());
  const [pendingInitialProjectTask, setPendingInitialProjectTask] = useState<PendingInitialProjectTask | null>(null);
  const initialProjectSessionCreatingRef = useRef(false);
  const initialProjectDraftSendingRef = useRef(false);
  const taskCreationInFlightRef = useRef(new Set<string>());
  const pendingProjectSelectionRef = useRef<string | null>(null);
  const {
    navigateToWorkspaceSession,
    selectedSessionId,
    loading,
    effectiveLoading,
    client,
    baseUrl,
    token,
    workspaces,
    sessionsByWorkspaceId,
    setSessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    errorsByWorkspaceId,
    setErrorsByWorkspaceId,
    workspaceConnectionOverrides,
    routeError,
    setRouteError,
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
  } = useWorkspaceRouteState({
    workContextId: activeWorkContextId,
    onServerSettingsChanged: () => setiPolloWorkServerSettingsVersion((value) => value + 1),
    onHostInfo: setiPolloWorkServerHostInfoState,
  });
  const conversation = useMemo(
    () => opencodeBaseUrl && selectedWorkspaceServerToken && !selectedWorkspaceError
      ? conversationEngineAdapters.get(selectedWorkspace?.engineId).connect({
          baseUrl: opencodeBaseUrl,
          token: selectedWorkspaceServerToken,
          directory: selectedWorkspaceRoot || undefined,
          serverBaseUrl: selectedWorkspaceEndpoint?.baseUrl,
          workspaceId: selectedWorkspaceEndpoint?.workspaceId,
        })
      : null,
    [opencodeBaseUrl, selectedWorkspace?.engineId, selectedWorkspaceEndpoint?.baseUrl, selectedWorkspaceEndpoint?.workspaceId, selectedWorkspaceError, selectedWorkspaceRoot, selectedWorkspaceServerToken],
  );
  const conversationConnectionKey = `${selectedWorkspace?.engineId?.trim() || DEFAULT_ENGINE_ID}:${opencodeBaseUrl}:${selectedWorkspaceServerToken}`;
  const activeEngineId = selectedWorkspace?.engineId?.trim() || DEFAULT_ENGINE_ID;
  const activeEnginePreferences = getEnginePreferences(local.prefs, activeEngineId);
  const selectedModel = local.prefs.model;
  const selectedMode = activeEnginePreferences.mode;
  const [modeSelectionLocked, setModeSelectionLocked] = useState(false);
  useEffect(() => {
    setModeSelectionLocked(false);
  }, [activeEngineId, selectedSessionId]);
  const engineProviderClient = useMemo(() => {
    if (activeEngineId === DEFAULT_ENGINE_ID) return opencodeClient;
    if (!selectedWorkspaceEndpoint || !selectedWorkspaceServerToken) return null;
    return providerEngineAdapters.createClient(activeEngineId, {
      endpoint: selectedWorkspaceEndpoint,
      directory: selectedWorkspace?.path,
    });
  }, [activeEngineId, opencodeClient, selectedWorkspace?.path, selectedWorkspaceEndpoint, selectedWorkspaceServerToken]);
  const sharedProviderWorkspace = useMemo(
    () => selectSharedProviderWorkspace(workspaces, selectedWorkspace),
    [selectedWorkspace, workspaces],
  );
  const sharedProviderEndpoint = useMemo(
    () => resolveWorkspaceEndpoint(sharedProviderWorkspace, {
      baseUrl,
      token,
      hostToken: ipolloworkServerHostInfoState?.hostToken,
    }),
    [baseUrl, ipolloworkServerHostInfoState?.hostToken, sharedProviderWorkspace, token],
  );
  // Provider discovery/auth is an app-level OpenCode control plane even when
  // the selected workspace runs another agent engine. Every mounted workspace
  // exposes the managed OpenCode sidecar through its `/opencode` endpoint.
  const sharedProviderEngineId = DEFAULT_ENGINE_ID;
  const sharedProviderRoot = sharedProviderWorkspace?.path?.trim() || "";
  const sharedProviderAuthWorkspace = useMemo(
    () => sharedProviderWorkspace
      ? { ...sharedProviderWorkspace, engineId: DEFAULT_ENGINE_ID }
      : null,
    [sharedProviderWorkspace],
  );
  const sharedProviderClient = useMemo(() => {
    if (!sharedProviderEndpoint?.token) return null;
    return providerEngineAdapters.createClient(sharedProviderEngineId, {
      endpoint: sharedProviderEndpoint,
      directory: sharedProviderRoot,
    });
  }, [sharedProviderEndpoint, sharedProviderEngineId, sharedProviderRoot]);
  const modelCatalogSources = useMemo<readonly ProviderListQueryInput[]>(() => {
    const sources: ProviderListQueryInput[] = [];
    if (sharedProviderClient) {
      sources.push({
        client: sharedProviderClient,
        engineId: sharedProviderEngineId,
        baseUrl: sharedProviderEndpoint?.opencodeBaseUrl,
        directory: sharedProviderRoot || undefined,
      });
    }
    return sources;
  }, [sharedProviderClient, sharedProviderEndpoint?.opencodeBaseUrl, sharedProviderEngineId, sharedProviderRoot]);
  useSessionMcpMaintenance({
    cloudSignedIn: denAuth.isSignedIn && activeWorkContextId === PERSONAL_WORK_CONTEXT_ID,
    client: selectedWorkspaceEndpoint?.client ?? null,
    workspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
  });
  const setSelectedMode = useCallback(
    (mode: string | null) => {
      local.setPrefs((previous) => updateEnginePreferences(
        previous,
        activeEngineId,
        (selection) => ({ ...selection, mode }),
      ));
    },
    [activeEngineId, local.setPrefs],
  );
  // One-way latch for "a refreshRouteState is currently running"; prevents
  // overlapping route refreshes from queueing up when the user clicks fast.
  const [developerMode, setDeveloperMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("ipollowork.developerMode") === "1";
  });
  const [paletteAccessibleTargets, setPaletteAccessibleTargets] = useState<OpenTarget[]>([]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, string>>({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>([]);
  const [disabledProviderIds, setDisabledProviderIds] = useState<string[]>([]);
  // Bump to re-filter provider list when den session changes (sign-in/out)
  const [denSessionVersion, setDenSessionVersion] = useState(0);
  useEffect(() => {
    const handler = () => setDenSessionVersion((v) => v + 1);
    window.addEventListener(denSessionUpdatedEvent, handler);
    return () => window.removeEventListener(denSessionUpdatedEvent, handler);
  }, []);
  useEffect(() => {
    const handler = () => setActiveWorkContextId(readActiveWorkContextId());
    window.addEventListener(workContextChangedEvent, handler);
    return () => window.removeEventListener(workContextChangedEvent, handler);
  }, []);

  // Provider IDs that were just added — used to highlight them as
  useEffect(() => {
    setPaletteAccessibleTargets([]);
  }, [selectedSessionId, selectedWorkspaceId]);

  // Provider catalog cache. Used to compute the reasoning/thinking variant
  // options for whichever model is currently selected so the composer's
  // behavior pill actually shows its options (bug: was empty before).

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
  const { engineReloadVersion, reloadWorkspaceEngineFromUi } = useEngineReload({
    client,
    workspaceId: selectedWorkspaceId,
    workspace: selectedWorkspace,
    endpointForWorkspace,
    activeReloadBlockingSessions,
    onError: setRouteError,
    refreshRouteState,
  });

  const environmentRuntimeKey = useMemo(
    () => buildiPolloWorkEnvRuntimeKey({
      baseUrl: client?.baseUrl ?? null,
      pid: ipolloworkServerHostInfoState?.pid ?? null,
      port: ipolloworkServerHostInfoState?.port ?? null,
    }),
    [client?.baseUrl, ipolloworkServerHostInfoState?.pid, ipolloworkServerHostInfoState?.port],
  );

  const handleApplyEnvironmentChanges = useCallback(async () => {
    if (!isDesktopRuntime()) {
      throw new Error(t("settings.environment.apply_unavailable"));
    }
    if (activeReloadBlockingSessions.length > 0) {
      throw new Error(t("settings.environment.apply_blocked_active_tasks"));
    }
    if (!selectedWorkspaceRoot) {
      throw new Error(t("settings.environment.apply_no_local_workspace"));
    }
    const reloaded = await reloadWorkspaceEngineFromUi();
    if (!reloaded) {
      throw new Error(t("app.error_connect_first"));
    }
  }, [activeReloadBlockingSessions.length, reloadWorkspaceEngineFromUi, selectedWorkspaceRoot]);

  const remoteWorkspaceConnectionEditor = useRemoteWorkspaceConnectionEditor({
    workspaces,
    onSaved: handleRemoteWorkspaceConnectionSaved,
  });

  const visibleSessionsByWorkspaceId = useMemo(
    () => Object.fromEntries(
      Object.entries(userVisibleSessionsByWorkspaceId(sessionsByWorkspaceId)).map(([workspaceId, sessions]) => [
        workspaceId,
        sessions.filter((session) => !isProjectBuilderSession(workspaceId, session.id)),
      ]),
    ),
    [sessionsByWorkspaceId],
  );
  const projectSessionLists = useMemo(
    () => toProjectSessionLists(workspaces, visibleSessionsByWorkspaceId, errorsByWorkspaceId, new Set(retryingWorkspaceIds)),
    [errorsByWorkspaceId, retryingWorkspaceIds, visibleSessionsByWorkspaceId, workspaces],
  );

  const selectProject = useCallback(async (workspaceId: string) => {
    const project = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!project) return false;

    pendingProjectSelectionRef.current = workspaceId;
    setLegacySelectedWorkspaceId(workspaceId);
    writeActiveWorkspaceId(workspaceId);
    rememberProjectForWorkContext(activeWorkContextId, workspaceId);

    if (!sessionsByWorkspaceId[workspaceId]?.length) {
      setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
      void loadWorkspaceSessionsInBackground([project]);
    }

    const knownSessions = (sessionsByWorkspaceId[workspaceId] ?? []).filter(
      (session) => !isProjectBuilderSession(workspaceId, session.id),
    );
    const rememberedSessionId = readLastSessionFor(workspaceId);
    const targetSessionId = knownSessions.find((session) => session.id === rememberedSessionId)?.id
      ?? knownSessions[0]?.id
      ?? null;
    if (targetSessionId) writeLastSessionFor(workspaceId, targetSessionId);
    navigateToWorkspaceSession(workspaceId, targetSessionId);
    return true;
  }, [
    activeWorkContextId,
    endpointForWorkspace,
    loadWorkspaceSessionsInBackground,
    navigateToWorkspaceSession,
    sessionsByWorkspaceId,
    setLegacySelectedWorkspaceId,
    setRetryingWorkspaceIds,
    workspaces,
  ]);

  const openNewTaskInWorkspace = useCallback((workspaceId: string) => {
    const project = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!project) return false;
    setLegacySelectedWorkspaceId(workspaceId);
    writeActiveWorkspaceId(workspaceId);
    rememberProjectForWorkContext(activeWorkContextId, workspaceId);
    navigateToWorkspaceSession(workspaceId, null);
    focusPromptSoon();
    return true;
  }, [activeWorkContextId, navigateToWorkspaceSession, setLegacySelectedWorkspaceId, workspaces]);

  useEffect(() => {
    const workspaceId = pendingProjectSelectionRef.current;
    if (!workspaceId || selectedWorkspaceId !== workspaceId) return;
    if (selectedSessionId) {
      pendingProjectSelectionRef.current = null;
      return;
    }

    const project = projectSessionLists.find((entry) => entry.workspace.id === workspaceId);
    if (!project || project.status === "loading") return;

    pendingProjectSelectionRef.current = null;
    if (project.status !== "ready" || project.sessions.length === 0) return;

    const latestSession = project.sessions.reduce((latest, session) => {
      const latestUpdatedAt = latest.time?.updated ?? latest.time?.created ?? 0;
      const sessionUpdatedAt = session.time?.updated ?? session.time?.created ?? 0;
      return sessionUpdatedAt > latestUpdatedAt ? session : latest;
    });
    if (!latestSession.id) return;

    writeLastSessionFor(workspaceId, latestSession.id);
    navigateToWorkspaceSession(workspaceId, latestSession.id, { replace: true });
  }, [navigateToWorkspaceSession, projectSessionLists, selectedSessionId, selectedWorkspaceId]);

  const createProject = useCallback(async (input: {
    name: string;
    folderPath: string;
    engineId: BuiltInWorkspaceEngineId;
  }) => {
    const name = input.name.trim();
    const requestedFolderPath = input.folderPath.trim();
    if (!name) throw new Error(t("projects.name_required"));
    if (requestedFolderPath) {
      const requestedFolderKey = normalizeDirectoryPath(requestedFolderPath);
      const existingProject = workspaces.find((workspace) =>
        workspace.workspaceType !== "remote"
        && normalizeDirectoryPath(workspace.path) === requestedFolderKey
      );
      if (existingProject) {
        throw new Error(t("projects.folder_already_in_use"));
      }
    }
    if (!client) throw new Error(t("projects.server_unavailable"));
    const workContextId = activeWorkContextId === PERSONAL_WORK_CONTEXT_ID ? null : activeWorkContextId;
    let folderPath = requestedFolderPath;
    let desktopProjectId: string | null = null;

    if (isDesktopRuntime()) {
      const desktopState = await workspaceCreate({
        folderPath: folderPath || undefined,
        name,
        preset: "starter",
        workContextId,
        engineId: input.engineId,
      });
      const desktopProject = desktopState.workspaces.find((workspace) => workspace.id === desktopState.selectedId)
        ?? desktopState.workspaces.find((workspace) => workspace.path === folderPath)
        ?? null;
      if (!desktopProject) throw new Error(t("projects.create_failed"));
      desktopProjectId = desktopProject.id;
      folderPath = desktopProject.path;
    }

    if (!folderPath) throw new Error(t("projects.create_failed"));

    const result = await client.createLocalWorkspace({
      folderPath,
      name,
      preset: "starter",
      workContextId,
      engineId: input.engineId,
    });
    const project = result.workspaces.find((workspace) => workspace.id === desktopProjectId)
      ?? result.workspaces.find((workspace) => workspace.path === folderPath)
      ?? null;
    if (!project) throw new Error(t("projects.create_failed"));

    if (isDesktopRuntime()) {
      await workspaceSetSelected(project.id);
      await workspaceSetRuntimeActive(project.id);
    }
    await client.activateWorkspace(project.id, { persist: true });
    setLegacySelectedWorkspaceId(project.id);
    writeActiveWorkspaceId(project.id);
    rememberProjectForWorkContext(activeWorkContextId, project.id);
    await refreshRouteState();
    navigateToWorkspaceSession(project.id);
    return project.id;
  }, [activeWorkContextId, client, navigateToWorkspaceSession, refreshRouteState, setLegacySelectedWorkspaceId, workspaces]);

  const renameProject = useCallback(async (workspaceId: string, name: string) => {
    const trimmed = name.trim();
    if (!client || !trimmed) return;
    await client.updateWorkspaceDisplayName(workspaceId, trimmed);
    if (isDesktopRuntime()) {
      await workspaceUpdateDisplayName({ workspaceId, displayName: trimmed });
    }
    await refreshRouteState();
  }, [client, refreshRouteState]);

  const revealProject = useCallback(async (workspaceId: string) => {
    const project = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!project?.path || !isDesktopRuntime()) return;
    await revealDesktopItemInDir(project.path);
  }, [workspaces]);

  const deleteProject = useCallback(async (workspaceId: string) => {
    const fallback = workspaces.find((workspace) => workspace.id !== workspaceId && !workspace.isDefault)
      ?? workspaces.find((workspace) => workspace.id !== workspaceId);
    if (client) await client.deleteWorkspace(workspaceId);
    if (isDesktopRuntime()) await workspaceForget(workspaceId);
    writeLastSessionFor(workspaceId, null);
    if (fallback) {
      await selectProject(fallback.id);
    } else {
      writeActiveWorkspaceId(null);
      rememberProjectForWorkContext(activeWorkContextId, null);
      setLegacySelectedWorkspaceId("");
      navigateToWorkspaceSession("", null, { replace: true });
    }
    await refreshRouteState();
  }, [activeWorkContextId, client, navigateToWorkspaceSession, refreshRouteState, selectProject, setLegacySelectedWorkspaceId, workspaces]);
  const seedWorkspaceActivitySessions = useSessionActivityStore((state) => state.seedWorkspaceSessions);
  const sessionActivityByWorkspaceId = useSessionActivityStore((state) => state.statusesByWorkspaceId);

  useEffect(() => {
    for (const workspace of workspaces) {
      const sessions = sessionsByWorkspaceId[workspace.id] ?? [];
      seedWorkspaceActivitySessions(workspace.id, sessions);
      const serverId = workspaceServerId(workspace);
      if (serverId && serverId !== workspace.id) {
        seedWorkspaceActivitySessions(serverId, sessions);
      }
    }
  }, [seedWorkspaceActivitySessions, sessionsByWorkspaceId, workspaces]);

  const sidebarSessionStatusById = useMemo(() => {
    const next: Record<string, string> = {};
    for (const project of projectSessionLists) {
      const serverId = workspaceServerId(project.workspace);
      const workspaceStatuses = {
        ...(sessionActivityByWorkspaceId[project.workspace.id] ?? {}),
        ...(serverId ? sessionActivityByWorkspaceId[serverId] ?? {} : {}),
      };
      for (const session of project.sessions) {
        const status = workspaceStatuses[session.id];
        if (status) next[session.id] = status;
      }
    }
    return next;
  }, [sessionActivityByWorkspaceId, projectSessionLists]);

  const sidebarActiveWorkspaceId = useMemo(() => {
    const sessionId = selectedSessionId?.trim() ?? "";
    if (sessionId) {
      const owner = projectSessionLists.find((project) =>
        project.sessions.some((session) => session?.id === sessionId),
      );
      if (owner?.workspace.id) return owner.workspace.id;
    }
    return selectedWorkspaceId;
  }, [selectedSessionId, selectedWorkspaceId, projectSessionLists]);

  const workspaceConnectionStateById = useMemo(() => {
    const next: Record<string, WorkspaceConnectionState> = { ...workspaceConnectionOverrides };
    for (const workspace of workspaces) {
      if (workspace.workspaceType !== "remote") continue;
      const error = errorsByWorkspaceId[workspace.id]?.trim();
      if (!error || next[workspace.id]?.status === "connecting") continue;
      next[workspace.id] ??= {
        status: "error",
        message: getWorkspaceTaskLoadErrorDisplay(workspace, error).message || error,
        checkedAt: null,
      };
    }
    return next;
  }, [errorsByWorkspaceId, workspaceConnectionOverrides, workspaces]);

  const mcpConnectedCount = useMcpConnectedCount(opencodeClient, selectedWorkspaceRoot);
  const { store: sessionProviderAuthStore, snapshot: sessionProviderAuthSnapshot } =
    useSessionProviderAuth({
      engineClient: sharedProviderClient,
      providers,
      providerDefaults,
      providerConnectedIds,
      disabledProviderIds,
      selectedWorkspace: sharedProviderAuthWorkspace,
      selectedWorkspaceEndpoint: sharedProviderEndpoint,
      providerBaseUrl: sharedProviderEndpoint?.opencodeBaseUrl ?? "",
      selectedWorkspaceRoot: sharedProviderRoot,
      selectedWorkspaceId: sharedProviderAuthWorkspace?.id ?? "",
      setProviders,
      setProviderDefaults,
      setProviderConnectedIds,
      setDisabledProviderIds,
    });
  const hiddenProviderIds = useMemo(
    () => [
      ...new Set([
        ...disabledProviderIds,
        ...sessionProviderAuthSnapshot.explicitlyDisconnectedProviderIds,
      ]),
    ].sort(),
    [disabledProviderIds, sessionProviderAuthSnapshot.explicitlyDisconnectedProviderIds],
  );
  const providerListQuery = useMergedProviderListQuery({
    sources: modelCatalogSources,
    enabled: modelCatalogSources.length > 0,
  });
  const activeProviderSource = useMemo<ProviderListQueryInput | null>(() => (
    engineProviderClient
      ? {
          client: engineProviderClient,
          engineId: activeEngineId,
          baseUrl: selectedWorkspaceEndpoint?.opencodeBaseUrl,
          directory: selectedWorkspaceRoot || undefined,
        }
      : null
  ), [activeEngineId, engineProviderClient, selectedWorkspaceEndpoint?.opencodeBaseUrl, selectedWorkspaceRoot]);
  const activeProviderListQuery = useProviderListQuery({
    client: activeProviderSource?.client ?? null,
    engineId: activeProviderSource?.engineId,
    baseUrl: activeProviderSource?.baseUrl,
    directory: activeProviderSource?.directory,
  });
  const accountProviderList = filterProviderList(
    projectAccountProviderConnections(
      mergeProviderListResponses([providerListQuery.data, activeProviderListQuery.data]),
      sessionProviderAuthSnapshot.connectedProviderIds,
    ) ?? mergeProviderListResponses([]),
    hiddenProviderIds,
  );
  const activeProviderList = activeProviderListQuery.data
    ? filterProviderList(activeProviderListQuery.data, hiddenProviderIds)
    : undefined;
  const modelPicker = useModelPicker({
    client: engineProviderClient,
    engineId: activeEngineId,
    baseUrl: selectedWorkspaceEndpoint?.opencodeBaseUrl ?? "",
    workspaceRoot: selectedWorkspaceRoot,
    catalogSources: modelCatalogSources,
    runtimeSource: activeProviderSource,
    connectedProviderIds: sessionProviderAuthSnapshot.connectedProviderIds,
    disabledProviderIds: hiddenProviderIds,
  });
  const setSelectedModel = useCallback((model: ModelRef) => {
    local.setPrefs((previous) => updateModelPreferences(
      previous,
      (selection) => ({
        model,
        modelVariant: selection.model?.providerID === model.providerID
          && selection.model.modelID === model.modelID
          ? selection.modelVariant
          : null,
      }),
    ));
  }, [local.setPrefs]);
  const setModelVariant = useCallback((modelVariant: string | null) => {
    local.setPrefs((previous) => updateModelPreferences(
      previous,
      (selection) => ({ ...selection, modelVariant }),
    ));
  }, [local.setPrefs]);
  const selectableModels = getSelectableChatModelSnapshot(activeProviderList);
  const customProvidersRestricted = checkDesktopRestriction({ restriction: "allowCustomProviders" });
  const permittedSelectableModels = selectableModels.filter((provider) => (
    !isDesktopProviderBlocked({
      providerId: provider.providerID,
      checkRestriction: checkDesktopRestriction,
    }) && (
      !customProvidersRestricted ||
      sessionProviderAuthSnapshot.connectedProviderIds.some(
        (providerId) => providerId.trim() === provider.providerID.trim(),
      )
    )
  ));
  const activeSelectedModel = activeProviderList
    ? resolveEngineSelectableChatModel({
        providers: permittedSelectableModels,
        defaults: activeProviderList.default,
        preferred: selectedModel,
      })
    : null;
  const usesSharedModelPreference = Boolean(
    selectedModel &&
    activeSelectedModel &&
    selectedModel.providerID === activeSelectedModel.providerID &&
    selectedModel.modelID === activeSelectedModel.modelID,
  );
  const activeModelVariant = usesSharedModelPreference
    ? local.prefs.modelVariant
    : null;
  const { providerCatalog, modelVariantLabel, modelBehaviorOptions, modelVariantValue } =
    useModelBehavior({
      providerList: accountProviderList,
      defaultModel: activeSelectedModel,
      modelVariant: activeModelVariant,
    });
  const selectedModelSupportsAttachments = modelSupportsAttachments(providerCatalog, activeSelectedModel);
  const selectedModelUnavailable = Boolean(!activeSelectedModel);
  const hasUsableModel = Boolean(activeSelectedModel && !selectedModelUnavailable);
  // Creating and opening a conversation does not require a usable model.
  // Keeping this separate from `canCreateTask` prevents a first-run workspace
  // from landing on an empty pane when its model setup is still incomplete or
  // an old saved model is no longer available.
  const canCreateSession = Boolean(
    conversation && selectedWorkspaceId && !loading && !selectedWorkspaceError,
  );
  const canCreateTask = Boolean(
    canCreateSession && !selectedModelUnavailable,
  );

  const iPolloWorkModelsPromo = useiPolloWorkModelsStartupPromo({
    clientReady: Boolean(opencodeClient),
    workspaceId: selectedWorkspaceId,
    providerConnectedIds: sessionProviderAuthSnapshot.connectedProviderIds,
    // Cloud sign-in is always an explicit user action. New local installs
    // enter the workspace directly instead of receiving a login promotion.
    suppressed: true,
  });

  const {
    activePermission,
    permissionReplyBusy,
    respondPermission,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    todos,
  } = useSessionInteractions({
    connection: conversation,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    workspaceRoot: selectedWorkspaceRoot,
    ipolloworkServerClient: selectedWorkspaceEndpoint?.client ?? client,
    runtimeWorkspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
  });
  useEffect(() => {
    if (!sharedProviderClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      setDisabledProviderIds([]);
      return;
    }

    let cancelled = false;

    const applyProviderState = (value: ProviderListResponse) => {
      if (cancelled) return;
      // When not signed in, filter out cloud-managed providers (lpr_*)
      // so stale entries from a previous session don't appear.
      const hasCloudAuth = !!readDenSettings().authToken?.trim();
      const isCloudProvider = (id: string) => /^lpr_/i.test(id);
      const all = hasCloudAuth
        ? value.all
        : value.all.filter(
            (p) => !isCloudProvider(p.id ?? ""),
          );
      const connected = hasCloudAuth
        ? (value.connected ?? [])
        : (value.connected ?? []).filter((id) => !isCloudProvider(id));
      setProviders(all);
      setProviderDefaults(value.default ?? {});
      setProviderConnectedIds(connected);
      // New-provider detection is handled globally by the provider auth
      // store's applyProviderListState, which fires dispatchNewProviders.
    };

    void (async () => {
      let disabledProviders: string[] = [];
      try {
        disabledProviders = await providerEngineAdapters
          .get(sharedProviderEngineId)
          .connect(sharedProviderClient)
          .readDisabledProviders();
        if (!cancelled) setDisabledProviderIds(disabledProviders);
      } catch {
        // ignore config read failures and continue with provider discovery
      }

      try {
        applyProviderState(
          filterProviderList(
            await ensureProviderListQuery(getReactQueryClient(), {
              client: sharedProviderClient,
              engineId: sharedProviderEngineId,
              baseUrl: sharedProviderEndpoint?.opencodeBaseUrl,
              directory: sharedProviderRoot || undefined,
            }),
            disabledProviders,
          ),
        );
      } catch {
        if (cancelled) return;
        setProviders([]);
        setProviderDefaults({});
        setProviderConnectedIds([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [denSessionVersion, sharedProviderClient, sharedProviderEndpoint?.opencodeBaseUrl, sharedProviderEngineId, sharedProviderRoot]);

  const modelLabel = activeSelectedModel
    ? resolveModelDisplayName(activeSelectedModel.modelID)
    : t("session.default_model");

  const listSlashCommands = useCallback(async (): Promise<SlashCommandOption[]> => {
    // engineReloadVersion is included so the callback identity changes after
    // an engine reload, which invalidates the composer's command list cache
    // and causes it to re-fetch (picking up newly created skills).
    void engineReloadVersion;
    if (!conversation) return [];
    return conversation.listCommands(selectedWorkspaceRoot || undefined);
  }, [conversation, engineReloadVersion, selectedWorkspaceRoot]);

  const listModes = useCallback(async () => {
    void engineReloadVersion;
    return conversation ? conversation.listModes() : [];
  }, [conversation, engineReloadVersion]);

  // Shared by @ mentions and the command palette. Plan and build are product
  // modes controlled beside the model; hidden and subagent-only entries are
  // task-tool delegation targets rather than session-level agents.
  const listAgents = useCallback(async () => {
    // Include engineReloadVersion so the composer refetches after newly added
    // agent files become available, even when the inline picker is hidden.
    void engineReloadVersion;
    if (!conversation) return [];
    const list = await conversation.listAgents();
    return list.filter((agent) =>
      !agent.hidden
      && agent.mode !== "subagent"
      && agent.name !== "build"
      && agent.name !== "plan"
    );
  }, [conversation, engineReloadVersion]);

  const handleOpenSettings = useCallback((route = "/settings/preferences", workspaceId = sidebarActiveWorkspaceId) => {
    const sessionId = workspaceId === sidebarActiveWorkspaceId ? selectedSessionId : null;
    const tab = route.replace(/^\/settings\/?/, "").replace(/^\/+|\/+$/g, "") || "preferences";
    const target = workspaceId ? workspaceSettingsRoute(workspaceId, tab) : route;
    writeActiveWorkspaceId(workspaceId || null);
    navigate(target, { state: { workspaceId, sessionId } });
  }, [navigate, selectedSessionId, sidebarActiveWorkspaceId]);

  const handleOpenHelp = useCallback(() => {
    const returnTo = sidebarActiveWorkspaceId
      ? workspaceSessionRoute(sidebarActiveWorkspaceId, selectedSessionId)
      : "/session";
    navigate("/help", { state: { returnTo } });
  }, [navigate, selectedSessionId, sidebarActiveWorkspaceId]);

  const invalidateProjectExecutionQueries = useCallback(() => {
    const queryClient = getReactQueryClient();
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["work-items"] }),
      queryClient.invalidateQueries({ queryKey: ["project-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["project-runtime-metrics"] }),
    ]);
  }, []);

  const finishProjectExecution = useCallback((input: {
    sessionId: string;
    status: "done" | "failed";
    error?: string | null;
  }) => {
    if (!selectedWorkspaceEndpoint || isProjectBuilderSession(selectedWorkspaceId, input.sessionId)) return;
    const session = sessionsByWorkspaceIdRef.current[selectedWorkspaceId]?.find((item) => item.id === input.sessionId);
    const title = session?.title?.trim() || t("session.untitled");
    void selectedWorkspaceEndpoint.client.finishProjectSessionExecution(
      selectedWorkspaceEndpoint.workspaceId,
      input.sessionId,
      { status: input.status, title, error: input.error ?? null },
    ).then(invalidateProjectExecutionQueries).catch(() => undefined);
  }, [invalidateProjectExecutionQueries, selectedWorkspaceEndpoint, selectedWorkspaceId, sessionsByWorkspaceIdRef]);

  const handleSessionStatus = useCallback((update: { sessionId: string; status: ConversationStatus }) => {
    if (update.status.type !== "idle" || !selectedWorkspaceEndpoint) return;
    finishProjectExecution({ sessionId: update.sessionId, status: "done" });
    const { contexts, complete, completeWithoutChange, fail } = useDesignAiSelectionStore.getState();
    const runningContexts = Object.values(contexts).filter((context) => (
      context.sessionId === update.sessionId
      && context.workspaceId === selectedWorkspaceEndpoint.workspaceId
    ));

    for (const context of runningContexts) {
      if (!useDesignAiSelectionStore.getState().claimCompletion(context.id)) continue;
      void (async () => {
        try {
          const after = await selectedWorkspaceEndpoint.client.readWorkspaceFile(context.workspaceId, context.filePath);
          if (after.content !== context.beforeHtml) {
            complete(context.id, {
              afterHtml: after.content,
              afterUpdatedAt: after.updatedAt ?? null,
            });
          } else {
            completeWithoutChange(context.id);
            toast.info("No Design change was detected.");
          }
        } catch {
          fail(context.id);
        }
      })();
    }
  }, [finishProjectExecution, selectedWorkspaceEndpoint]);

  const handleSessionError = useCallback((update: { sessionId: string; errorText: string }) => {
    finishProjectExecution({ sessionId: update.sessionId, status: "failed", error: update.errorText });
  }, [finishProjectExecution]);

  const surfaceProps = useMemo(() => {
    if (!client || !selectedWorkspaceId || !opencodeBaseUrl || !token || !conversation) {
      return null;
    }
    // Transient-safety: when the user switches workspaces the URL-driven
    // selectedSessionId may still point at a session from the old workspace
    // for one render tick. Only block rendering when we KNOW the session
    // belongs to a different workspace (i.e., it exists in another
    // workspace's list). A brand-new session that hasn't been refreshed
    // into any list yet must still render so "New task" feels instant.
    let sessionOwnedByOtherWorkspace = false;
    for (const [workspaceId, sessions] of Object.entries(sessionsByWorkspaceId)) {
      if (workspaceId === selectedWorkspaceId) continue;
      if ((sessions ?? []).some((session) => session?.id === selectedSessionId)) {
        sessionOwnedByOtherWorkspace = true;
        break;
      }
    }
    if (sessionOwnedByOtherWorkspace) {
      return null;
    }

    // Note: do NOT include `client`, `workspaceId`, `sessionId`,
    // `opencodeBaseUrl`, or `ipolloworkToken` here. SessionPage forwards those
    // explicitly to SessionSurface from the per-workspace endpoint resolved
    // by `resolveWorkspaceEndpoint`. If we leak them in here, the spread of
    // `surfaceProps` in SessionPage overrides those correct values with the
    // local server's, and remote workspaces silently end up calling the
    // local server with the local `rem_*` id.
    return {
      conversation,
      workspaceRoot: selectedWorkspaceRoot,
      developerMode: false,
      modelLabel,
      onModelClick: () => {
        modelPicker.setQuery("");
        modelPicker.setOpen(true);
      },
      modelPickerOpen: modelPicker.compactOpen,
      modelUnavailable: selectedModelUnavailable,
      selectedModel: activeSelectedModel ?? { providerID: "", modelID: "" },
      onModelPickerOpenChange: (open: boolean) => {
        if (open && !hasUsableModel) {
          void sessionProviderAuthStore.openProviderAuthModal({ returnFocusTarget: "composer" });
          return;
        }
        modelPicker.setCompactOpen(open);
      },
      onModelChange: (model: ModelRef) => {
        setSelectedModel(model);
        modelPicker.setCompactOpen(false);
      },
      onConfigureModels: (providerId?: string) => {
        void sessionProviderAuthStore.openProviderAuthModal({
          returnFocusTarget: "composer",
          ...(providerId ? { preferredProviderId: providerId } : {}),
        });
      },
      onConfigureTokenStar: () => {
        void sessionProviderAuthStore.openProviderAuthModal({
          returnFocusTarget: "composer",
          preferredProviderId: "tokenstar",
        });
      },
      providerConnectedCount: hasUsableModel
        ? 1
        : sessionProviderAuthSnapshot.connectedProviderIds.length,
      onOpenSettingsSection: (section: "commands" | "skills" | "mcps" | "plugins" | "providers") => {
        handleOpenSettings(section === "skills" ? "/settings/skills" : section === "mcps" ? "/settings/extensions/mcp" : section === "plugins" ? "/settings/extensions/plugins" : section === "providers" ? "/settings/ai" : "/settings/preferences");
      },
      onSendDraft: async (
        draft: ComposerDraft,
        sessionId: string,
        dispatchOptions?: PromptDispatchOptions,
      ) => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return false;
        const projectBuilderActive = isProjectBuilderSession(selectedWorkspaceId, targetSessionId);
        if (projectBuilderActive) {
          if (!selectedWorkspaceEndpoint) throw new Error(t("work.project_unavailable"));
          await selectedWorkspaceEndpoint.client.activateProjectBuilderSession(
            selectedWorkspaceEndpoint.workspaceId,
            targetSessionId,
          );
          draft = scopeProjectBuilderDraft(draft, selectedWorkspace?.name?.trim() || t("project_overview.title"));
        }
        const text = (draft.resolvedText ?? draft.text).trim();
        if (!text && draft.attachments.length === 0) return false;

        let effectiveModel = activeSelectedModel;
        let effectiveMode = selectedMode;
        let effectiveModelVariant = modelVariantValue;
        let projectSystemContext: string | null = null;
        let projectExecutionStarted = false;
        const finishStartedExecution = async (status: "done" | "failed", error?: string | null) => {
          if (!projectExecutionStarted || !selectedWorkspaceEndpoint) return;
          await selectedWorkspaceEndpoint.client.finishProjectSessionExecution(
            selectedWorkspaceEndpoint.workspaceId,
            targetSessionId,
            { status, error: error ?? null },
          ).catch((finishError) => console.warn("[project-execution] could not persist the send result", finishError));
          invalidateProjectExecutionQueries();
        };

        if (!projectBuilderActive && selectedWorkspaceEndpoint) {
          const session = sessionsByWorkspaceId[selectedWorkspaceId]?.find((item) => item.id === targetSessionId);
          const item = await selectedWorkspaceEndpoint.client.startProjectSessionExecution(
            selectedWorkspaceEndpoint.workspaceId,
            targetSessionId,
            {
              title: session?.title?.trim() || t("session.untitled"),
              runtime: {
                engineId: activeEngineId,
                model: activeSelectedModel
                  ? { providerId: activeSelectedModel.providerID, modelId: activeSelectedModel.modelID }
                  : null,
                mode: selectedMode ?? null,
                modelVariant: modelVariantValue,
              },
            },
          );
          if (!item.execution) throw new Error("The project task did not return an execution binding");
          projectExecutionStarted = true;
          effectiveModel = item.execution.runtime.model
            ? {
                providerID: item.execution.runtime.model.providerId,
                modelID: item.execution.runtime.model.modelId,
              }
            : null;
          effectiveMode = item.execution.runtime.mode;
          effectiveModelVariant = item.execution.runtime.modelVariant;
          projectSystemContext = projectExecutionSystemContext(item.execution);
          invalidateProjectExecutionQueries();
        }

        const effectiveModelUnavailable = Boolean(
          providerListQuery.data && (
            !effectiveModel || !permittedSelectableModels.some((model) => (
              model.providerID === effectiveModel.providerID && model.modelIDs.includes(effectiveModel.modelID)
            ))
          ),
        );
        const effectiveModelSupportsAttachments = modelSupportsAttachments(providerCatalog, effectiveModel);
        if (
          !effectiveModelSupportsAttachments
          && draft.attachments.some((attachment) => attachmentRequiresNativeModelSupport(attachment.mimeType))
        ) {
          await finishStartedExecution("failed", t("composer.attachments_require_multimodal"));
          toast.warning(t("composer.attachments_require_multimodal"));
          return false;
        }
        if (effectiveModelUnavailable) {
          await finishStartedExecution("failed", "Selected model is unavailable.");
          toast.error("Selected model is unavailable.", {
            description: "Choose another model before sending.",
            action: {
              label: "Choose model",
              onClick: () => {
                modelPicker.setQuery("");
                modelPicker.setCompactOpen(true);
              },
            },
            cancel: {
              label: "Configure",
              onClick: () => {
                void sessionProviderAuthStore.openProviderAuthModal({ returnFocusTarget: "composer" });
              },
            },
          });
          return false;
        }

        let pendingTitlePersist: string | null = null;
        const targetSession = (sessionsByWorkspaceId[selectedWorkspaceId] ?? [])
          .find((session) => session.id === targetSessionId);
        if (text && (!targetSession || isDefaultSessionTitle(targetSession.title))) {
          const initialTitle = sessionTitleFromFirstPrompt(text);
          if (initialTitle) {
            pendingTitlePersist = initialTitle;
            setSessionsByWorkspaceId((current) => ({
              ...current,
              [selectedWorkspaceId]: (current[selectedWorkspaceId] ?? []).map((session) => (
                session.id === targetSessionId ? { ...session, title: initialTitle } : session
              )),
            }));
          }
        }

        captureAnalyticsEvent("task_message_sent", {
          mode: draft.mode ?? "prompt",
          is_command: Boolean(draft.command),
          attachment_count: draft.attachments.length,
          text_length: text.length,
          workspace_type: selectedWorkspace?.workspaceType ?? "unknown",
          provider_id: effectiveModel?.providerID ?? null,
          model_id: effectiveModel?.modelID ?? null,
        });
        markTaskRunStart(targetSessionId);
        // Den org adoption signals (auth-gated inside; no-op when signed out).
        // Lives here — the live send choke point — because its previous call
        // site was in the orphaned actions-store and never fired.
        const projectDimension = readWorkspaceProjectDimension(selectedWorkspaceId);
        const telemetryDimensions = projectDimension
          ? [{
              type: "project",
              label: projectDimension.label,
            }]
          : undefined;
        trackSessionActive(targetSessionId, telemetryDimensions);
        trackTaskStarted(targetSessionId, telemetryDimensions);

        if (draft.mode === "shell") {
          try {
            await conversation.shell(targetSessionId, text);
            await finishStartedExecution("done");
            return true;
          } catch (error) {
            await finishStartedExecution("failed", describeRouteError(error));
            throw error;
          }
        }

        if (draft.command) {
          try {
            await conversation.runCommand({
              sessionId: targetSessionId,
              command: draft.command.name,
              arguments: draft.command.arguments,
              model: effectiveModel ?? undefined,
              reasoningEffort: effectiveModelVariant ?? undefined,
            });
            return true;
          } catch (error) {
            await finishStartedExecution("failed", describeRouteError(error));
            throw error;
          }
        }

        try {
        const designSelectionScope = selectedWorkspaceEndpoint
          ? { sessionId: targetSessionId, workspaceId: selectedWorkspaceEndpoint.workspaceId }
          : undefined;
        const designSelectionContexts = designSelectionContextsForDraft(
          draft,
          useDesignAiSelectionStore,
          designSelectionScope,
        );
        const [parts, persistedAttachments] = await Promise.all([
          draftToParts(
            draft,
            selectedWorkspaceRoot,
            useDesignAiSelectionStore,
            designSelectionScope,
            { supportsNativeAttachments: effectiveModelSupportsAttachments },
          ),
          selectedWorkspaceEndpoint
            ? persistComposerAttachments({
                attachments: draft.attachments,
                workspaceId: selectedWorkspaceEndpoint.workspaceId,
                sessionId: targetSessionId,
                client: selectedWorkspaceEndpoint.client,
              })
            : Promise.resolve([]),
        ]);
        const attachmentInstruction = persistedAttachmentInstruction(persistedAttachments);
        if (attachmentInstruction) {
          parts.push({ type: "text", text: attachmentInstruction, synthetic: true });
        }
        const capabilitySystemContext = draft.capability?.instruction ?? null;
        // Template-session metadata is authoritative. The in-memory surface
        // cache is used only for legacy sessions created before that record
        // existed, so an already-open Video Studio still gets its contract.
        const [envSystemContext, initialSessionTemplate] = await Promise.all([
          buildiPolloWorkEnvSystemContext(client, {
            cacheKey: targetSessionId,
            runtimeKey: environmentRuntimeKey,
          }),
          selectedWorkspaceEndpoint
            ? selectedWorkspaceEndpoint.client.getTemplateSession(selectedWorkspaceEndpoint.workspaceId, targetSessionId).catch(() => null)
            : Promise.resolve(null),
        ]);
        const sessionTemplates: TemplateSessionSnapshot[] = initialSessionTemplate ? [initialSessionTemplate] : [];
        let automaticTemplateInstruction: string | null = null;
        const sessionTypeBeforeRouting = readSessionType(targetSessionId);
        const automaticTemplateIntents = sessionTypeBeforeRouting === "work"
          ? inferConversationTemplateIntents(text)
          : [];
        if (sessionTemplates.length === 0 && automaticTemplateIntents.length > 0 && selectedWorkspaceEndpoint) {
          const templateInstructions: string[] = [];
          try {
            const templateScope = readActiveWorkContextId();
            const catalog = await selectedWorkspaceEndpoint.client.listTemplates(
              selectedWorkspaceEndpoint.workspaceId,
              templateScope,
            );
            for (const intent of automaticTemplateIntents) {
              const artifactSessionId = automaticTemplateIntents.length === 1
                ? targetSessionId
                : conversationArtifactSessionId(targetSessionId, intent.category);
              let artifactTemplate = await selectedWorkspaceEndpoint.client
                .getTemplateSession(selectedWorkspaceEndpoint.workspaceId, artifactSessionId)
                .catch(() => null);
              if (!artifactTemplate) {
                const selectedTemplate = selectConversationTemplate(text, catalog.items, intent.category);
                if (selectedTemplate) {
                  const materialized = await selectedWorkspaceEndpoint.client.materializeTemplate(
                    selectedWorkspaceEndpoint.workspaceId,
                    selectedTemplate.manifest.id,
                    artifactSessionId,
                    conversationTemplateBrief(text),
                    templateScope,
                  );
                  artifactTemplate = {
                    sessionId: artifactSessionId,
                    surface: materialized.manifest.surface,
                    authoring: false,
                    state: materialized.state,
                    manifest: materialized.manifest,
                  } satisfies TemplateSessionSnapshot;
                } else {
                  artifactTemplate = await selectedWorkspaceEndpoint.client.createTemplateAuthoringSession(
                    selectedWorkspaceEndpoint.workspaceId,
                    {
                      sessionId: artifactSessionId,
                      category: intent.category,
                      pptxCompatibility: intent.category === "slides" && /\bpptx?\b|可编辑|导出.{0,5}ppt/i.test(text)
                        ? "native-editable"
                        : undefined,
                      purpose: "artifact-delivery",
                    },
                  );
                }
              }
              sessionTemplates.push(artifactTemplate);
              setSessionType(artifactSessionId, sessionTypeForTemplate(artifactTemplate.manifest));
              templateInstructions.push(templateBriefPrompt({
                template: artifactTemplate.manifest,
                entryPath: artifactTemplate.state.entry,
                briefPath: artifactTemplate.state.briefPath,
              }));
            }
            automaticTemplateInstruction = [
              ...templateInstructions,
              ...(templateInstructions.length > 1 ? [
                `Multi-artifact delivery contract: this request requires all ${templateInstructions.length} prepared artifacts. Complete every entry above in this turn; do not replace one artifact with a description, outline, export, or link to another. In the final answer, mention every exact entry path so iPolloWork renders one separate clickable output card for each artifact.`,
              ] : []),
            ].join("\n\n");
          } catch (error) {
            // Automatic surface selection is an interaction enhancement. If
            // the local template service is unavailable, preserve normal chat
            // delivery instead of blocking the user's prompt.
            console.warn("[template-auto-route] Could not initialize the artifact surfaces", error);
            sessionTemplates.length = 0;
          }
        }
        // Claim a pre-template Studio project before the prompt is sent. This
        // is the one-time migration that makes the persisted session record,
        // the agent contract, and the right-side Studio point at one path.
        if (sessionTemplates.length === 0 && selectedWorkspaceEndpoint && readSessionType(targetSessionId) === "video") {
          const adoptedTemplate = await selectedWorkspaceEndpoint.client
            .adoptLegacyVideoSession(selectedWorkspaceEndpoint.workspaceId, targetSessionId)
            .catch(() => null);
          if (adoptedTemplate) sessionTemplates.push(adoptedTemplate);
        }
        const cachedSessionType = readSessionType(targetSessionId);
        const videoSessionTemplates = sessionTemplates.filter((template) => template.manifest.surface === "video");
        const isLegacyVideoTask = videoSessionTemplates.length === 0 && shouldInjectVideoTaskContext(null, cachedSessionType);
        const videoPromptText = draft.resolvedText ?? draft.text;
        const videoDeliveryRequirements = videoDeliveryRequirementsForPrompt({
          capabilityId: draft.capability?.id,
          promptText: videoPromptText,
        });
        const videoTasks = videoSessionTemplates.length > 0
          ? videoSessionTemplates.map((template) => ({ sessionId: template.sessionId, template }))
          : isLegacyVideoTask
            ? [{ sessionId: targetSessionId, template: null }]
            : [];
        const videoSystemContexts = await Promise.all(videoTasks.map(async ({ sessionId, template }) => {
          let includeVoiceoverContext = videoDeliveryRequirements.voiceover;
          if (!includeVoiceoverContext && selectedWorkspaceEndpoint) {
            const entryPath = template?.state.entry ?? videoProjectEntryPath(sessionId);
            const entry = await selectedWorkspaceEndpoint.client
              .readWorkspaceFile(selectedWorkspaceEndpoint.workspaceId, entryPath)
              .catch(() => null);
            includeVoiceoverContext = videoCompositionHasVoiceover(entry?.content);
          }
          return videoTaskSystemContext(
            sessionId,
            selectedWorkspaceRoot,
            template?.manifest ?? null,
            { includeVoiceover: includeVoiceoverContext, deliveryRequirements: videoDeliveryRequirements },
          );
        }));
        const designSessionTemplates = sessionTemplates.filter((template) => template.manifest.surface === "design");
        const designSystemContexts = designSessionTemplates.map((template) => designHtmlThemeSystemContext({
          id: template.manifest.id,
          category: template.manifest.category,
          title: template.manifest.title,
          entry: template.state.entry,
          tokenPath: template.manifest.designSystem.tokens ?? "design-tokens.css",
          applyChecklist: template.manifest.applyChecklist,
        }));
        const authoringSystemContexts = await Promise.all(sessionTemplates.map(async (template) => {
          let selectedDesignSystemGuide: string | null = null;
          if (template.authoring && selectedWorkspaceEndpoint && template.manifest.designSystem.tokens) {
            const entryDirectory = template.state.entry.split("/").slice(0, -1).join("/");
            const tokenPath = `${entryDirectory}/${template.manifest.designSystem.tokens}`;
            const tokenFile = await selectedWorkspaceEndpoint.client
              .readWorkspaceFile(selectedWorkspaceEndpoint.workspaceId, tokenPath)
              .catch(() => null);
            const appliedDesignSystemId = readAppliedDesignSystemId(tokenFile?.content);
            if (appliedDesignSystemId && appliedDesignSystemId !== "default") {
              const { loadDesignSystemAuthoringGuide } = await import("@/react-app/domains/session/design/design-system-registry");
              selectedDesignSystemGuide = await loadDesignSystemAuthoringGuide(appliedDesignSystemId).catch(() => null);
            }
          }
          return templateAuthoringSystemContext(template, selectedDesignSystemGuide);
        }));
        const languageSystemContext = responseLanguageSystemContext(currentLocale());
        const systemContext = [projectSystemContext, envSystemContext, ...videoSystemContexts, ...designSystemContexts, ...authoringSystemContexts, capabilitySystemContext, languageSystemContext]
          .filter((value): value is string => Boolean(value?.trim()))
          .join("\n\n");
        // Version history is a site-only workflow. Slides and every other
        // design category keep their single session artifact without creating
        // website-style snapshots before each AI turn.
        if (selectedWorkspaceEndpoint) {
          for (const designTemplate of designSessionTemplates) {
            if (designTemplate.manifest.category !== "site") continue;
            const designPath = designTemplate.state.entry;
            try {
              const currentDesign = await selectedWorkspaceEndpoint.client.readWorkspaceFile(selectedWorkspaceEndpoint.workspaceId, designPath);
              let versionContent = currentDesign.content;
              const selectedVersionPath = window.localStorage.getItem(`ipollowork.session-design-version.${designTemplate.sessionId}`);
              if (selectedVersionPath && selectedVersionPath !== "current") {
                const selectedVersion = await selectedWorkspaceEndpoint.client.readWorkspaceFile(selectedWorkspaceEndpoint.workspaceId, selectedVersionPath);
                await selectedWorkspaceEndpoint.client.writeWorkspaceFile(selectedWorkspaceEndpoint.workspaceId, {
                  path: designPath,
                  content: selectedVersion.content,
                  baseUpdatedAt: currentDesign.updatedAt ?? null,
                });
                versionContent = selectedVersion.content;
                window.localStorage.setItem(`ipollowork.session-design-version.${designTemplate.sessionId}`, "current");
              }
              await selectedWorkspaceEndpoint.client.writeWorkspaceFile(selectedWorkspaceEndpoint.workspaceId, {
                path: `design/.versions/${designTemplate.sessionId}/${Date.now()}-before-ai.html`,
                content: versionContent,
                baseUpdatedAt: null,
              });
              await getReactQueryClient().invalidateQueries({
                queryKey: ["design-html-catalog", selectedWorkspaceEndpoint.workspaceId],
              });
              await getReactQueryClient().invalidateQueries({
                queryKey: ["design-html", selectedWorkspaceEndpoint.workspaceId, designPath],
              });
            } catch (error) {
              throw new Error(`Could not create the Design version before this AI update: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
          }
        }
        const capabilityPromptPart = draft.capability
          ? [{
              type: "text" as const,
              text: draft.capability.instruction,
              synthetic: true,
            }]
          : [];
        const automaticTemplatePromptPart = automaticTemplateInstruction
          ? [{
              type: "text" as const,
              text: automaticTemplateInstruction,
              synthetic: true,
            }]
          : [];
        const promptParts = [
          ...capabilityPromptPart,
          ...automaticTemplatePromptPart,
          ...parts,
        ];
        if (designSelectionContexts.length > 0 && !selectedWorkspaceEndpoint) {
          throw new Error("The selected Design element is no longer available in this workspace.");
        }
        const promptResult = await promptDesignSelectionContexts({
          contexts: designSelectionContexts,
          workspaceClient: selectedWorkspaceEndpoint?.client ?? {
            readWorkspaceFile: async () => { throw new Error("The selected Design element is no longer available in this workspace."); },
            writeWorkspaceFile: async () => { throw new Error("The selected Design element is no longer available in this workspace."); },
          },
          prompt: () => conversation.sendPrompt({
            sessionId: targetSessionId,
            clientUserMessageId: dispatchOptions?.clientUserMessageId,
            parts: promptParts,
            model: effectiveModel ?? undefined,
            mode: effectiveMode ?? undefined,
            reasoningEffort: effectiveModel?.providerID === "tokenstar" && effectiveModelVariant && tokenStarModelSupportsEffort(effectiveModel.modelID)
              ? effectiveModelVariant
              : undefined,
            variant: effectiveModel?.providerID === "tokenstar" && tokenStarModelSupportsEffort(effectiveModel.modelID)
              ? undefined
              : effectiveModelVariant ?? undefined,
            system: systemContext || undefined,
          }),
        });
        const effectiveSessionId = promptResult.sessionId.trim() || targetSessionId;
        if (effectiveSessionId !== targetSessionId) {
          let replacementTitle = sessionTitleFromFirstPrompt(text) || t("session.untitled");
          setSessionsByWorkspaceId((current) => {
            const sessions = current[selectedWorkspaceId] ?? [];
            const replaced = sessions.find((session) => session.id === targetSessionId);
            replacementTitle = replaced?.title?.trim() || replacementTitle;
            const replacement = {
              ...(replaced ?? { title: replacementTitle, time: { created: Date.now(), updated: Date.now() } }),
              id: effectiveSessionId,
              slug: effectiveSessionId,
            };
            const nextSessions = sessions.some((session) => session.id === targetSessionId)
              ? sessions.map((session) => session.id === targetSessionId ? replacement : session)
              : [replacement, ...sessions];
            const next = {
              ...current,
              [selectedWorkspaceId]: nextSessions.filter((session, index) => (
                session.id !== effectiveSessionId || nextSessions.findIndex((item) => item.id === effectiveSessionId) === index
              )),
            };
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
          writeLastSessionFor(selectedWorkspaceId, effectiveSessionId);
          rememberPendingCreatedSession(selectedWorkspaceId, effectiveSessionId);
          navigateToWorkspaceSession(selectedWorkspaceId, effectiveSessionId, { replace: true });
          void conversation.rename(effectiveSessionId, replacementTitle, selectedWorkspaceRoot || undefined)
            .catch((error) => console.warn("[session-rebind] Could not persist the replacement task title", error));
        } else if (pendingTitlePersist) {
          // OpenCode 1.18.x can fail the first prompt when an empty session is
          // patched before SessionPrompt creates the initial user message.
          // Keep the optimistic local title, but persist it after the run is
          // accepted so title metadata never races the first message write.
          void conversation.rename(targetSessionId, pendingTitlePersist, selectedWorkspaceRoot || undefined)
            .catch((error) => console.warn("[session-title] Could not persist the first-prompt title", error));
        }
        return true;
        } catch (error) {
          await finishStartedExecution("failed", describeRouteError(error));
          throw error;
        }
      },
      onDraftChange: () => {
        // Draft persistence will be wired once the full React shell owns session state.
      },
      supportsNativeAttachments: selectedModelSupportsAttachments,
      modelVariantLabel,
      modelVariant: modelVariantValue,
      modelBehaviorOptions,
      onModelVariantChange: (value: string | null) => {
        setModelVariant(value);
      },
      selectedMode,
      onModeSelectionLockedChange: setModeSelectionLocked,
      listModes,
      onSelectMode: setSelectedMode,
      listAgents,
      onSelectAgent: setSelectedMode,
      listCommands: listSlashCommands,
      recentFiles: [],
      searchFiles: async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return [];
        return conversation.searchFiles(trimmed, selectedWorkspaceRoot || undefined);
      },
      isRemoteWorkspace: selectedWorkspace?.workspaceType === "remote",
      isSandboxWorkspace: selectedWorkspace ? isSandboxWorkspace(selectedWorkspace) : false,
      onRevertToMessage: async (messageId: string, sessionId: string) => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return false;
        try {
          await conversation.abort(targetSessionId, selectedWorkspaceRoot || undefined).catch(() => false);
          const reverted = await conversation.revert(targetSessionId, messageId);
          // Stamp the revert cursor into the local caches so the transcript
          // rewinds immediately instead of waiting for a full reload.
          applySessionRevert(selectedWorkspaceId, reverted);
          return true;
        } catch (error) {
          console.warn("[revert] failed", error);
          toast.error(t("session.revert_failed"));
          return false;
        }
      },
      onForkAtMessage: (messageId: string, sessionId: string, messages: UIMessage[]) => {
        void (async () => {
          const targetSessionId = sessionId.trim() || selectedSessionId;
          if (!targetSessionId) return;
          try {
            const forked = await conversation.fork({ sessionId: targetSessionId, messageId, messages });
            writeLastSessionFor(selectedWorkspaceId, forked.id);
            rememberPendingCreatedSession(selectedWorkspaceId, forked.id);
            setSessionsByWorkspaceId((current) => ({
              ...current,
              [selectedWorkspaceId]: [forked, ...(current[selectedWorkspaceId] ?? [])],
            }));
            navigateToWorkspaceSession(selectedWorkspaceId, forked.id);
            void refreshRouteState();
          } catch (error) {
            console.warn("[fork] failed", error);
            toast.error(t("session.branch_failed"));
          }
        })();
      },
      onChangeModel: (model: { providerID: string; modelID: string }) => {
        setSelectedModel(model);
      },
      environmentRuntimeKey,
      onApplyEnvironmentChanges: isDesktopRuntime() && selectedWorkspace?.workspaceType !== "remote"
        ? handleApplyEnvironmentChanges
        : undefined,
    };
  }, [
    client,
    conversation,
    activeEngineId,
    modelPicker.compactOpen,
    handleOpenSettings,
    hasUsableModel,
    handleApplyEnvironmentChanges,
    environmentRuntimeKey,
    listAgents,
    listModes,
    listSlashCommands,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    invalidateProjectExecutionQueries,
    navigateToWorkspaceSession,
    navigate,
    opencodeBaseUrl,
    sessionProviderAuthSnapshot.connectedProviderIds,
    providerCatalog,
    providerListQuery.data,
    permittedSelectableModels,
    selectedMode,
    activeSelectedModel,
    selectedSessionId,
    selectedModelSupportsAttachments,
    selectedModelUnavailable,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    rememberPendingCreatedSession,
    sessionsByWorkspaceIdRef,
    setModelVariant,
    setSelectedMode,
    setSelectedModel,
    sessionsByWorkspaceId,
    token,
  ]);

  // Keep the latest send callback available to async task-creation kickoffs.
  const surfacePropsRef = useRef<typeof surfaceProps>(null);
  useEffect(() => {
    surfacePropsRef.current = surfaceProps;
  });

  const previousSessionScopeRef = useRef<{
    workspaceId: string;
    sessionId: string;
    connectionKey: string;
  } | null>(null);
  useEffect(() => {
    const previous = previousSessionScopeRef.current;
    const current = selectedWorkspaceEndpoint && selectedSessionId && opencodeBaseUrl && selectedWorkspaceServerToken
      ? {
          workspaceId: selectedWorkspaceEndpoint.workspaceId,
          sessionId: selectedSessionId,
          connectionKey: conversationConnectionKey,
        }
      : null;

    if (
      previous &&
      (!current ||
        previous.workspaceId !== current.workspaceId ||
        previous.sessionId !== current.sessionId ||
        previous.connectionKey !== current.connectionKey)
    ) {
      destroyWorkspaceSessionResources(previous, previous.sessionId);
    }
    previousSessionScopeRef.current = current;
  }, [
    opencodeBaseUrl,
    conversationConnectionKey,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceServerToken,
  ]);

  const handleCreateTaskInWorkspace = useCallback(async (
    workspaceId: string,
    type: iPolloWorkSessionType = "work",
    templateId?: iPolloWorkTemplateId,
    templateScope?: WorkContextId,
    authoring?: { category: TemplateCategory; pptxCompatibility?: PptxCompatibility },
  ): Promise<string | null> => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (
      !workspace ||
      loading
    ) {
      return null;
    }
    const endpoint = resolveWorkspaceEndpoint(workspace, {
      baseUrl,
      token,
      hostToken: ipolloworkServerHostInfoState?.hostToken,
    });
    if (!endpoint || !endpoint.token) {
      return null;
    }
    if (taskCreationInFlightRef.current.has(workspaceId)) return null;
    taskCreationInFlightRef.current.add(workspaceId);
    let createdSessionId: string | null = null;
    let projectInitializationFailed = false;
    try {
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      setRouteError(null);
      const { item: session } = await endpoint.client.createSession(
        endpoint.workspaceId,
        undefined,
        activeSelectedModel,
      );
      createdSessionId = session.id;
      let sessionType = type;
      if (templateId) {
        try {
          const materialized = await endpoint.client.materializeTemplate(
            endpoint.workspaceId,
            templateId,
            session.id,
            undefined,
            templateScope ?? readActiveWorkContextId(),
          );
          sessionType = sessionTypeForTemplate(materialized.manifest);
        } catch (error) {
          projectInitializationFailed = true;
          throw error;
        }
      }
      if (authoring) {
        try {
          const created = await endpoint.client.createTemplateAuthoringSession(endpoint.workspaceId, {
            sessionId: session.id,
            category: authoring.category,
            pptxCompatibility: authoring.pptxCompatibility,
          });
          sessionType = sessionTypeForTemplate(created.manifest);
        } catch (error) {
          projectInitializationFailed = true;
          throw error;
        }
      }
      setSessionType(session.id, sessionType);
      captureAnalyticsEvent("task_created", {
        source: "new_task",
        workspace_type: workspace.workspaceType ?? "unknown",
      });
      toast.dismiss(taskCreateUnavailableToastId(workspaceId));
      toast.dismiss();
      setLegacySelectedWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId || null);
      writeLastSessionFor(workspaceId, session.id);
      rememberPendingCreatedSession(workspaceId, session.id);
      setSessionsByWorkspaceId((current) => {
        const next = {
          ...current,
          [workspaceId]: [session, ...(current[workspaceId] ?? [])],
        };
        sessionsByWorkspaceIdRef.current = next;
        return next;
      });
      navigateToWorkspaceSession(workspaceId, session.id);
      focusPromptSoon();
      void refreshRouteState();
      if (authoring) {
        const kickoff = templateAuthoringKickoff(authoring.category, authoring.pptxCompatibility);
        const send = surfacePropsRef.current?.onSendDraft;
        if (send) {
          void Promise.resolve(send({
            mode: "prompt",
            parts: [
              { type: "text", text: kickoff.text },
              { type: "text", text: kickoff.instruction, synthetic: true },
            ],
            attachments: [],
            text: kickoff.text,
            resolvedText: kickoff.text,
          }, session.id)).catch((error) => toast.error(describeRouteError(error)));
        }
      }
      return session.id;
    } catch (error) {
      const message = describeTaskCreateError(error);
      if ((templateId || authoring) && projectInitializationFailed) {
        if (createdSessionId) {
          await endpoint.client.deleteSession(endpoint.workspaceId, createdSessionId).catch(() => undefined);
        }
        setRouteError(null);
        setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
        toast.error(authoring ? "Could not create template" : "Template unavailable", {
          id: templateCreateUnavailableToastId(workspaceId, templateId ?? `authoring-${authoring?.category ?? "template"}`),
          description: message,
          action: {
            label: "Retry",
            onClick: () => void handleCreateTaskInWorkspace(workspaceId, type, templateId, templateScope, authoring),
          },
          duration: Infinity,
        });
        return null;
      }
      setRouteError(message);
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: message }));
      toast.error(describeWorkspaceUnavailableTitle({
        message,
        workspaceType: workspace.workspaceType,
      }), {
        id: taskCreateUnavailableToastId(workspaceId),
        description: message,
        action: {
          label: "Retry",
          onClick: () => void handleCreateTaskInWorkspace(workspaceId, type, templateId, templateScope),
        },
        duration: Infinity,
      });
      if (isTransientStartupError(message)) {
        setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
        if (startupRetryTimerRef.current === null) {
          startupRetryTimerRef.current = window.setTimeout(() => {
            startupRetryTimerRef.current = null;
            refreshInFlightRef.current = false;
            void refreshRouteState();
          }, 1_000);
        }
      }
      return null;
    } finally {
      taskCreationInFlightRef.current.delete(workspaceId);
    }
  }, [
    baseUrl,
    activeSelectedModel,
    ipolloworkServerHostInfoState?.hostToken,
    loading,
    navigateToWorkspaceSession,
    refreshRouteState,
    rememberPendingCreatedSession,
    token,
    workspaces,
  ]);

  const handleCreateInitialProjectTask = useCallback(async (draft: ComposerDraft, workspaceId?: string) => {
    if (pendingInitialProjectTask) return false;
    try {
      let targetWorkspaceId = workspaceId?.trim() || "";
      if (targetWorkspaceId) {
        if (!workspaces.some((workspace) => workspace.id === targetWorkspaceId)) return false;
      } else {
        targetWorkspaceId = await createProject({
          name: t("session.untitled"),
          folderPath: "",
          engineId: DEFAULT_ENGINE_ID,
        }) || "";
      }
      if (!targetWorkspaceId) return false;
      setPendingInitialProjectTask({
        workspaceId: targetWorkspaceId,
        sessionId: null,
        runtimeWorkspaceId: null,
        clientUserMessageId: null,
        draft,
      });
      return true;
    } catch (error) {
      toast.error(t("projects.create_failed"), {
        description: error instanceof Error ? error.message : t("app.unknown_error"),
      });
      return false;
    }
  }, [createProject, pendingInitialProjectTask, workspaces]);

  const handleCreateProjectBuilder = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const endpoint = workspace ? resolveWorkspaceEndpoint(workspace, {
      baseUrl,
      token,
      hostToken: ipolloworkServerHostInfoState?.hostToken,
    }) : null;
    if (!workspace || !endpoint?.token) return;

    const existingSessionId = projectBuilderSessionId(workspaceId);
    if (existingSessionId) {
      const exists = (sessionsByWorkspaceId[workspaceId] ?? []).some((session) => session.id === existingSessionId)
        || await endpoint.client.getSession(endpoint.workspaceId, existingSessionId).then(() => true).catch(() => false);
      if (exists) {
        markProjectBuilderSession(workspaceId, existingSessionId);
        await endpoint.client.activateProjectBuilderSession(endpoint.workspaceId, existingSessionId);
        writeActiveWorkspaceId(workspaceId);
        writeLastSessionFor(workspaceId, existingSessionId);
        navigateToWorkspaceSession(workspaceId, existingSessionId);
        focusPromptSoon();
        return;
      }
      forgetProjectBuilderSession(workspaceId, existingSessionId);
    }

    const sessionId = await handleCreateTaskInWorkspace(workspaceId, "work");
    if (!sessionId) return;
    markProjectBuilderSession(workspaceId, sessionId);
    const starterPrompt = t("project_builder.starter_prompt");
    saveSessionDraft(workspaceId, sessionId, {
      text: starterPrompt,
      mode: "prompt",
    });
    useComposerStateStore.getState().setDraft(sessionId, starterPrompt);

    const workspaceConversation = conversationEngineAdapters
      .get(workspace.engineId)
      .connect({
        baseUrl: endpoint.opencodeBaseUrl,
        token: endpoint.token,
        directory: workspace.path?.trim() || undefined,
        serverBaseUrl: endpoint.baseUrl,
        workspaceId: endpoint.workspaceId,
      });
    await workspaceConversation.rename(sessionId, t("project_builder.title"), workspace.path?.trim() || undefined).catch(() => undefined);
    void refreshRouteState();
  }, [
    baseUrl,
    handleCreateTaskInWorkspace,
    ipolloworkServerHostInfoState?.hostToken,
    navigateToWorkspaceSession,
    refreshRouteState,
    sessionsByWorkspaceId,
    token,
    workspaces,
  ]);

  const handleCreateTaskFromDraft = useCallback(async (workspaceId: string, draft: ComposerDraft) => {
    if (pendingInitialProjectTask || !workspaces.some((workspace) => workspace.id === workspaceId)) return false;
    setPendingInitialProjectTask({
      workspaceId,
      sessionId: null,
      runtimeWorkspaceId: null,
      clientUserMessageId: null,
      draft,
    });
    return true;
  }, [pendingInitialProjectTask, workspaces]);

  const cleanupFailedInitialProjectTask = useCallback(async (pending: PendingInitialProjectTask) => {
    const sessionId = pending.sessionId;
    if (!sessionId) return;
    if (pending.runtimeWorkspaceId) {
      rollbackOptimisticSessionPrompt(
        pending.runtimeWorkspaceId,
        sessionId,
        pending.clientUserMessageId,
      );
    }

    const workspace = workspaces.find((item) => item.id === pending.workspaceId);
    const endpoint = workspace ? resolveWorkspaceEndpoint(workspace, {
      baseUrl,
      token,
      hostToken: ipolloworkServerHostInfoState?.hostToken,
    }) : null;
    if (endpoint) {
      await endpoint.client.deleteSession(endpoint.workspaceId, sessionId)
        .catch((error) => console.warn("[session-create] Could not delete failed initial task", error));
    }
    forgetProjectBuilderSession(pending.workspaceId, sessionId);
    useDesignAiSelectionStore.getState().resetSession(sessionId);
    setSessionsByWorkspaceId((current) => {
      const next = {
        ...current,
        [pending.workspaceId]: (current[pending.workspaceId] ?? []).filter((session) => session.id !== sessionId),
      };
      sessionsByWorkspaceIdRef.current = next;
      return next;
    });
    writeLastSessionFor(pending.workspaceId, null);
    if (selectedWorkspaceId === pending.workspaceId && selectedSessionId === sessionId) {
      navigateToWorkspaceSession(pending.workspaceId, null, { replace: true });
    }
    await refreshRouteState();
  }, [
    baseUrl,
    ipolloworkServerHostInfoState?.hostToken,
    navigateToWorkspaceSession,
    refreshRouteState,
    selectedSessionId,
    selectedWorkspaceId,
    sessionsByWorkspaceIdRef,
    setSessionsByWorkspaceId,
    token,
    workspaces,
  ]);

  useEffect(() => {
    const pending = pendingInitialProjectTask;
    if (!pending || pending.sessionId || initialProjectSessionCreatingRef.current) return;
    if (!workspaces.some((workspace) => workspace.id === pending.workspaceId)) return;
    initialProjectSessionCreatingRef.current = true;
    void handleCreateTaskInWorkspace(pending.workspaceId).then((sessionId) => {
      if (!sessionId) {
        setPendingInitialProjectTask(null);
        return;
      }
      saveSessionDraft(pending.workspaceId, sessionId, {
        text: pending.draft.text,
        mode: pending.draft.mode,
      });
      const workspace = workspaces.find((item) => item.id === pending.workspaceId);
      const endpoint = workspace ? resolveWorkspaceEndpoint(workspace, {
        baseUrl,
        token,
        hostToken: ipolloworkServerHostInfoState?.hostToken,
      }) : null;
      const clientUserMessageId = endpoint
        ? beginOptimisticSessionPrompt(endpoint.workspaceId, sessionId, pending.draft.text)
        : null;
      setPendingInitialProjectTask((current) => current?.workspaceId === pending.workspaceId
        ? {
            ...current,
            sessionId,
            runtimeWorkspaceId: endpoint?.workspaceId ?? null,
            clientUserMessageId,
          }
        : current);
    }).finally(() => {
      initialProjectSessionCreatingRef.current = false;
    });
  }, [
    baseUrl,
    handleCreateTaskInWorkspace,
    ipolloworkServerHostInfoState?.hostToken,
    pendingInitialProjectTask,
    token,
    workspaces,
  ]);

  useEffect(() => {
    const pending = pendingInitialProjectTask;
    if (
      !pending?.sessionId
      || selectedWorkspaceId !== pending.workspaceId
      || selectedSessionId !== pending.sessionId
      || !surfaceProps
      || initialProjectDraftSendingRef.current
    ) return;
    initialProjectDraftSendingRef.current = true;
    void Promise.resolve(surfaceProps.onSendDraft(
      pending.draft,
      pending.sessionId,
      pending.clientUserMessageId ? { clientUserMessageId: pending.clientUserMessageId } : undefined,
    ))
      .then(async (dispatched) => {
        if (!dispatched) {
          await cleanupFailedInitialProjectTask(pending);
        }
      })
      .catch(async (error) => {
        await cleanupFailedInitialProjectTask(pending);
        toast.error(error instanceof Error ? error.message : t("app.unknown_error"));
      })
      .finally(() => {
        initialProjectDraftSendingRef.current = false;
        setPendingInitialProjectTask(null);
      });
  }, [cleanupFailedInitialProjectTask, pendingInitialProjectTask, selectedSessionId, selectedWorkspaceId, surfaceProps]);

  // Full-screen first-run loader. Armed once per app launch from the very
  // first render of a brand-new profile (no active-workspace memory yet) and
  // held through all boot-state churn AND route remounts — recomputing
  // visibility from volatile route state made it flicker, and a remount
  // would reset component state. It drops only when the first session is
  // selected, when the project-first starter is ready, on error (retry toast
  // must be reachable), when state settles and this turns out not to be a
  // first run, or after a safety timeout.
  const [firstRunLoaderActive, setFirstRunLoaderActive] = useState(() => {
    if (firstRunLoaderPhase === "unarmed") {
      firstRunLoaderPhase = isDesktopRuntime() && !readActiveWorkspaceId() ? "armed" : "done";
    }
    return firstRunLoaderPhase === "armed";
  });
  const dismissFirstRunLoader = useCallback(() => {
    firstRunLoaderPhase = "done";
    setFirstRunLoaderActive(false);
  }, []);
  useEffect(() => {
    if (!firstRunLoaderActive) return;
    // Safety cap only: a cold first engine boot measured 35–40s on a slow
    // Windows VM, so 30s cut the loader early and flashed the empty session
    // page. Errors and settled states still dismiss immediately below.
    const timeout = window.setTimeout(dismissFirstRunLoader, 120_000);
    return () => window.clearTimeout(timeout);
  }, [firstRunLoaderActive, dismissFirstRunLoader]);
  useEffect(() => {
    if (!firstRunLoaderActive) return;
    if (selectedSessionId) {
      dismissFirstRunLoader();
      return;
    }
    const workspaceError = selectedWorkspaceId ? errorsByWorkspaceId[selectedWorkspaceId] : null;
    if (routeError || selectedWorkspaceError || workspaceError) {
      dismissFirstRunLoader();
      return;
    }
    // Once workspace discovery has settled with no projects, the actionable
    // empty state is the destination. Do not hide its create-project button
    // behind the first-run resource loader until the safety timeout.
    if (!loading && workspaces.length === 0) {
      dismissFirstRunLoader();
      return;
    }
    if (
      !loading
      && selectedWorkspaceId
      && !workspaces.some((workspace) => !workspace.isDefault)
    ) {
      dismissFirstRunLoader();
      return;
    }
    // State settled and this profile already has sessions or last-session
    // memory (not a first run): hand back to the normal UI. The new-task
    // route remains sessionless until the user submits its first message.
    if (
      !loading &&
      selectedWorkspaceId &&
      !retryingWorkspaceIds.includes(selectedWorkspaceId) &&
      ((sessionsByWorkspaceId[selectedWorkspaceId] ?? []).length > 0 ||
        Boolean(readLastSessionFor(selectedWorkspaceId)) ||
        workspaces.some((workspace) => workspace.id === selectedWorkspaceId && !workspace.isDefault))
    ) {
      dismissFirstRunLoader();
    }
  }, [sessionsByWorkspaceId, firstRunLoaderActive, dismissFirstRunLoader, selectedSessionId, routeError, selectedWorkspaceError, errorsByWorkspaceId, loading, retryingWorkspaceIds, selectedWorkspaceId, workspaces]);

  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    sessionSearchOpen,
    setSessionSearchOpen,
    terminalOpen,
    setTerminalOpen,
  } = useShellShortcuts({
    canCreateTask,
    workspaceId: selectedWorkspaceId,
    onCreateTask: (workspaceId: string) => void openNewTaskInWorkspace(workspaceId),
  });
  useReactRenderWatchdog("SessionRoute", {
    selectedSessionId,
    selectedWorkspaceId,
    loading,
    workspaceCount: workspaces.length,
    sessionWorkspaceCount: Object.keys(sessionsByWorkspaceId).length,
    commandPaletteOpen,
    modelPickerOpen: modelPicker.open,
  });

  const navigateToSessionForControl = useCallback((sessionId: string) => {
    const owner = Object.entries(sessionsByWorkspaceId).find(([, sessions]) =>
      (sessions ?? []).some((session) => session?.id === sessionId),
    )?.[0];
    navigateToWorkspaceSession(owner || selectedWorkspaceId, sessionId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId, sessionsByWorkspaceId]);

  const navigateToSessionRootForControl = useCallback(() => {
    navigateToWorkspaceSession(selectedWorkspaceId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId]);

  const openModelPickerForControl = useCallback(() => {
    modelPicker.setOpen(true);
  }, []);

  useSessionControlActions({
    workspaces,
    sessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedSessionId,
    canCreateTask,
    ipolloworkClient: client,
    conversation,
    navigateToSession: navigateToSessionForControl,
    navigateToSessionRoot: navigateToSessionRootForControl,
    createTaskInWorkspace: handleCreateTaskInWorkspace,
    openModelPicker: openModelPickerForControl,
    refreshRouteState,
  });

  const commandPaletteControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "command_palette.open",
    label: "Open the command palette",
    description: "Open the in-app command palette so the next choice is visible.",
    sideEffect: "none",
    execute: () => setCommandPaletteOpen(true),
  }), []);
  useControlAction(commandPaletteControlAction);

  const addProviderControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "settings.provider.add",
    label: "Add a model provider",
    description: "Open the provider connection modal, optionally pre-filtered to a specific provider.",
    sideEffect: "mutation",
    requiresArgs: false,
    args: [
      { name: "providerId", type: "string" as const, required: false, description: "Provider id to pre-select, e.g. 'anthropic', 'openai', 'google'." },
    ],
    execute: async (rawArgs: unknown) => {
      if (
        providerEngineAdapters.get(sharedProviderEngineId).capabilities.customProviders
        && checkDesktopRestriction({ restriction: "allowCustomProviders" })
      ) {
        return { ok: false, error: "Custom providers are disabled by your organization." };
      }
      const providerId = typeof rawArgs === "object" && rawArgs !== null
        ? (rawArgs as Record<string, unknown>).providerId
        : undefined;
      const preferred = typeof providerId === "string" ? providerId.trim() : undefined;
      await sessionProviderAuthStore.openProviderAuthModal(
        preferred ? { preferredProviderId: preferred } : undefined,
      );
      return { ok: true, opened: "provider_auth_modal", preferredProviderId: preferred ?? null };
    },
  }), [checkDesktopRestriction, sessionProviderAuthStore, sharedProviderEngineId]);
  useControlAction(addProviderControlAction);

  const paletteSessionOptions = useMemo<PaletteSessionOption[]>(() => {
    return buildTaskPaletteSessionOptions(
      workspaces,
      visibleSessionsByWorkspaceId,
      selectedWorkspaceId,
    );
  }, [selectedWorkspaceId, visibleSessionsByWorkspaceId, workspaces]);

  const sessionSearchFetcher = useMemo<SessionMessageFetcher | null>(() => {
    if (!client) return null;
    // Cap the transcript fetch to keep multi-workspace scans fast; matches in
    // anything older than the most recent 400 messages are traded away for
    // responsiveness.
    return async (workspaceId: string, sessionId: string) =>
      (await client.getSessionMessages(workspaceId, sessionId, { limit: 400 })).items;
  }, [client]);

  const sessionSearchPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-search.open",
    title: "Search session messages",
    detail: "Deep search every session, including message content",
    meta: "Cmd/Ctrl+Shift+F",
    searchText: "search find sessions messages history transcript content",
    action: () => {
      setCommandPaletteOpen(false);
      setSessionSearchOpen(true);
    },
  }), []);

  const sessionFindPaletteItem = useMemo<PaletteItem | null>(() => {
    if (!selectedSessionId) return null;
    return {
      id: "session-find.open",
      title: "Find in conversation",
      detail: "Search within the current conversation",
      meta: "Cmd/Ctrl+F",
      searchText: "find search current conversation session messages transcript",
      action: () => {
        setCommandPaletteOpen(false);
        useSessionFindStore.getState().openFind({ sessionId: selectedSessionId });
      },
    };
  }, [selectedSessionId]);

  const terminalPaletteItems = useMemo<PaletteItem[]>(() => [
    {
      id: "terminal.toggle",
      title: terminalOpen ? "Hide terminal" : "Show terminal",
      detail: "Toggle the integrated terminal panel for this workspace",
      meta: "Cmd/Ctrl+J",
      searchText: "terminal shell command line console show hide toggle",
      action: () => {
        setCommandPaletteOpen(false);
        setTerminalOpen((value) => !value);
      },
    },
  ], [terminalOpen]);

  const developerModePaletteItem = useMemo<PaletteItem>(() => ({
    id: "developer-mode.toggle",
    title: developerMode ? t("settings.disable_developer_mode") : t("settings.enable_developer_mode"),
    detail: t("settings.developer_mode_desc"),
    meta: developerMode ? "On" : "Off",
    searchText: "developer dev mode debug diagnostics toggle enable disable",
    action: () => {
      setCommandPaletteOpen(false);
      setDeveloperMode((current) => {
        const next = !current;
        try { window.localStorage.setItem("ipollowork.developerMode", next ? "1" : "0"); } catch {}
        return next;
      });
    },
  }), [developerMode]);

  const buildCommandDiagnosticsBundle = useCallback(() => buildDiagnosticsBundleJson({
    anyActiveRuns: activeReloadBlockingSessions.length > 0,
    canReloadWorkspace: reloadCoordinator.canReloadWorkspaceEngine,
    clientConnected: canCreateTask,
    developerMode,
    hostInfo: ipolloworkServerHostInfoState,
    ipolloworkServerStatus: client ? "connected" : "disconnected",
    ipolloworkServerUrl: baseUrl,
    runtimeWorkspaceId: selectedWorkspaceEndpoint?.workspaceId ?? null,
  }), [
    activeReloadBlockingSessions.length,
    baseUrl,
    canCreateTask,
    client,
    developerMode,
    ipolloworkServerHostInfoState,
    reloadCoordinator.canReloadWorkspaceEngine,
    selectedWorkspaceEndpoint?.workspaceId,
  ]);

  const diagnosticsCopyPaletteItem = useMemo<PaletteItem>(() => ({
    id: "diagnostics.copy",
    title: t("session.cmd_diagnostics_copy_title"),
    detail: t("session.cmd_diagnostics_copy_detail"),
    searchText: "logs share diagnostics debug support bundle troubleshoot copy report issue",
    action: async () => {
      setCommandPaletteOpen(false);
      try {
        const json = await buildCommandDiagnosticsBundle();
        await navigator.clipboard.writeText(json);
        toast.success(t("session.diagnostics_copied"));
      } catch (error) {
        toast.error(t("session.diagnostics_failed"), { description: describeRouteError(error) });
      }
    },
  }), [buildCommandDiagnosticsBundle]);

  const diagnosticsExportPaletteItem = useMemo<PaletteItem>(() => ({
    id: "diagnostics.export",
    title: t("session.cmd_diagnostics_export_title"),
    detail: t("session.cmd_diagnostics_export_detail"),
    searchText: "logs export diagnostics debug support bundle save file json download",
    action: async () => {
      setCommandPaletteOpen(false);
      try {
        const json = await buildCommandDiagnosticsBundle();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadTextAsFile(`ipollowork-diagnostics-${timestamp}.json`, json, "application/json");
        toast.success(t("session.diagnostics_exported"));
      } catch (error) {
        toast.error(t("session.diagnostics_failed"), { description: describeRouteError(error) });
      }
    },
  }), [buildCommandDiagnosticsBundle]);

  const reloadConfigPaletteItem = useMemo<PaletteItem>(() => ({
    id: "reload-opencode-config",
    title: t("session.cmd_reload_config_title"),
    detail: t("session.cmd_reload_config_detail"),
    meta: reloadCoordinator.canReloadWorkspaceEngine
      ? t("config.reload_engine")
      : t("system.reload_unavailable"),
    searchText: "reload opencode config providers models mcp jsonc refresh re-read engine restart",
    action: () => {
      setCommandPaletteOpen(false);
      if (!reloadCoordinator.canReloadWorkspaceEngine) return;
      void reloadCoordinator.reloadWorkspaceEngine();
    },
  }), [reloadCoordinator.canReloadWorkspaceEngine, reloadCoordinator.reloadWorkspaceEngine]);

  const handleArchiveSession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (!conversation) return;
      try {
        await conversation.setArchived(
          sessionId,
          archived,
          selectedWorkspaceRoot || undefined,
        );
        await refreshRouteState();
      } catch (error) {
        console.error("[session-route] archive session failed", error);
        toast.error(
          archived
            ? t("session_management.archive_failed")
            : t("session_management.unarchive_failed"),
          { description: describeRouteError(error) },
        );
      }
    },
    [conversation, refreshRouteState, selectedWorkspaceRoot],
  );

  return (
    <WorkspaceProvider
      client={engineProviderClient}
      engineId={activeEngineId}
      opencodeBaseUrl={opencodeBaseUrl}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
      modelCatalogSources={modelCatalogSources}
      connectedProviderIds={sessionProviderAuthSnapshot.connectedProviderIds}
      hiddenProviderIds={hiddenProviderIds}
    >
    {conversation && selectedWorkspaceEndpoint && opencodeBaseUrl && selectedWorkspaceServerToken ? (
      <ReactSessionRuntime
        // Use the server-side workspace id (the one without the `rem_`
        // prefix) so the React Query cache keys session-sync writes match
        // the keys SessionSurface reads from. Otherwise events arrive but
        // the UI never sees them and gets stuck on "thinking".
        workspaceId={selectedWorkspaceEndpoint.workspaceId}
        sessionId={selectedSessionId}
        connection={conversation}
        connectionKey={conversationConnectionKey}
        onSessionUpdated={handleRuntimeSessionUpdated}
        onSessionStatus={handleSessionStatus}
        onSessionError={handleSessionError}
      />
    ) : null}
    <SessionPage
      selectedSessionId={selectedSessionId}
      selectedSessionKnown={selectedSessionKnown}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedWorkspaceDisplay={selectedWorkspace ? {
        id: selectedWorkspace.id,
        name: selectedWorkspace.name ?? undefined,
        displayName: selectedWorkspace.displayNameResolved,
        workspaceType: selectedWorkspace.workspaceType,
        engineId: activeEngineId,
      } : { workspaceType: "local" }}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
      selectedWorkspaceError={selectedWorkspaceError}
      runtimeWorkspaceId={selectedWorkspaceEndpoint?.workspaceId || null}
      opencodeBaseUrl={opencodeBaseUrl}
      workspaces={workspaces}
      clientConnected={canCreateSession}
      ipolloworkServerStatus={client ? "connected" : "disconnected"}
      ipolloworkServerClient={selectedWorkspaceEndpoint?.client ?? client}
      environmentClient={client}
      ipolloworkServerToken={selectedWorkspaceServerToken}
      developerMode={developerMode}
      headerStatus={canCreateTask ? t("status.connected") : t("session.loading_detail")}
      busyHint={effectiveLoading ? t("session.loading_detail") : null}
      startupPhase={effectiveLoading ? "nativeInit" : "ready"}
      providerConnectedIds={sessionProviderAuthSnapshot.connectedProviderIds}
      hasUsableModel={hasUsableModel}
      providers={providers}
      mcpConnectedCount={mcpConnectedCount}
      onOpenSettings={() => handleOpenSettings("/settings/preferences")}
      onOpenHelp={handleOpenHelp}
      providerAuthModal={sessionProviderAuthSnapshot.providerAuthModalOpen ? {
        open: true,
        loading: false,
        submitting: sessionProviderAuthSnapshot.providerAuthBusy,
        error: sessionProviderAuthSnapshot.providerAuthError,
        preferredProviderId: sessionProviderAuthSnapshot.providerAuthPreferredProviderId,
        workerType: sessionProviderAuthSnapshot.providerAuthWorkerType,
        providers: sessionProviderAuthSnapshot.providerAuthProviders.filter(
          (provider) => !isDesktopProviderBlocked({ providerId: provider.id, checkRestriction: checkDesktopRestriction }),
        ),
        connectedProviderIds: sessionProviderAuthSnapshot.connectedProviderIds,
        authMethods: Object.fromEntries(
          Object.entries(sessionProviderAuthSnapshot.providerAuthMethods).filter(
            ([providerId]) => !isDesktopProviderBlocked({ providerId, checkRestriction: checkDesktopRestriction }),
          ),
        ),
        onSelect: sessionProviderAuthStore.startProviderAuth,
        onSubmitApiKey: async (providerId, apiKey, modelIds) => {
          const result = await sessionProviderAuthStore.submitProviderApiKey(providerId, apiKey, modelIds);
          modelPicker.setRecentProviderIds(new Set([providerId]));
          modelPicker.setQuery("");
          modelPicker.setOpen(true);
          return result;
        },
        onConnectCloudProvider: async (cloudProviderId) => {
          const result = await sessionProviderAuthStore.connectCloudProvider(cloudProviderId);
          modelPicker.setRecentProviderIds(new Set([cloudProviderId]));
          modelPicker.setQuery("");
          modelPicker.setOpen(true);
          return result;
        },
        onSubmitOAuth: sessionProviderAuthStore.completeProviderAuthOAuth,
        onDisconnectProvider: sessionProviderAuthStore.disconnectProvider,
        onRefreshProviders: sessionProviderAuthStore.refreshProviders,
        onClose: () => sessionProviderAuthStore.closeProviderAuthModal(),
      } : null}
      settingsSlot={
        <SettingsSurface
          embedded
          initialPath="extensions"
          workspaceId={selectedWorkspaceId}
          onClose={() => {
            try {
              window.dispatchEvent(new CustomEvent("ipollowork-close-right-pane"));
            } catch {
              // ignore
            }
          }}
        />
      }
      terminalOpen={terminalOpen}
      onTerminalOpenChange={setTerminalOpen}
      sidebar={{
        projectSessionLists,
        selectedWorkspaceId,
        selectedSessionId,
        developerMode: false,
        sessionStatusById: sidebarSessionStatusById,
        connectingWorkspaceId: null,
        workspaceConnectionStateById,
        newTaskDisabled: !canCreateSession,
        startupPhase: effectiveLoading ? "nativeInit" : "ready",
        onOpenSession: (workspaceId, sessionId) => {
          setLegacySelectedWorkspaceId(workspaceId);
          writeActiveWorkspaceId(workspaceId || null);
          writeLastSessionFor(workspaceId, sessionId);
          navigateToWorkspaceSession(workspaceId, sessionId);
        },
        onSelectProject: selectProject,
        onCreateProject: createProject,
        onCreateInitialProjectTask: handleCreateInitialProjectTask,
        onCreateTaskFromDraft: handleCreateTaskFromDraft,
        onRenameProject: renameProject,
        onRevealProject: revealProject,
        onDeleteProject: deleteProject,
        onPrefetchSession: () => {},
          onCreateTaskInWorkspace: (workspaceId, type, templateId, templateScope) => {
            if (!templateId && type === undefined) {
            openNewTaskInWorkspace(workspaceId);
            return null;
            }
            return handleCreateTaskInWorkspace(workspaceId, type, templateId, templateScope);
          },
          onCreateProjectBuilder: handleCreateProjectBuilder,
        onCreateTemplateAuthoring: (workspaceId, input) =>
          handleCreateTaskInWorkspace(workspaceId, "work", undefined, undefined, input),
        onCreateTaskWithPrompt: (workspaceId, prompt) => {
          void (async () => {
            const workspace = workspaces.find((item) => item.id === workspaceId);
            if (!workspace) return;
            const endpoint = resolveWorkspaceEndpoint(workspace, {
              baseUrl,
              token,
              hostToken: ipolloworkServerHostInfoState?.hostToken,
            });
            if (!endpoint?.token) return;
            try {
              const { item: session } = await endpoint.client.createSession(
                endpoint.workspaceId,
                undefined,
                activeSelectedModel,
              );
              saveSessionDraft(workspaceId, session.id, { text: prompt, mode: "prompt" });
              writeActiveWorkspaceId(workspaceId || null);
              writeLastSessionFor(workspaceId, session.id);
              rememberPendingCreatedSession(workspaceId, session.id);
              setSessionsByWorkspaceId((current) => {
                const next = {
                  ...current,
                  [workspaceId]: [session, ...(current[workspaceId] ?? [])],
                };
                sessionsByWorkspaceIdRef.current = next;
                return next;
              });
              navigateToWorkspaceSession(workspaceId, session.id);
              focusPromptSoon();
            } catch {
              // Fall back to normal task creation without prompt
              void handleCreateTaskInWorkspace(workspaceId);
            }
          })();
        },
        onRecoverWorkspace: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "recover"),
        onTestWorkspaceConnection: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "test"),
        onEditWorkspaceConnection: remoteWorkspaceConnectionEditor.open,
        onOpenSessionSearch: () => setSessionSearchOpen(true),
      }}
      surface={surfaceProps}
      initialTaskDraftPending={
        pendingInitialProjectTask &&
        !selectedSessionId &&
        pendingInitialProjectTask.workspaceId === selectedWorkspaceId
          ? pendingInitialProjectTask.draft
          : null
      }
      history={{
        canUndo: false,
        canRedo: false,
        busyAction: null,
        onUndo: () => {},
        onRedo: () => {},
      }}
      todos={todos}
      sessionLoadingById={(sessionId) => effectiveLoading && Boolean(sessionId && sessionId === selectedSessionId)}
      activePermission={activePermission}
      permissionReplyBusy={permissionReplyBusy}
      respondPermission={respondPermission}
      activeQuestion={activeQuestion}
      questionReplyBusy={questionReplyBusy}
      respondQuestion={respondQuestion}
      safeStringify={safeStringify}
      onRenameSession={
        conversation
          ? async (sessionId, nextTitle) => {
              const trimmed = nextTitle.trim();
              if (!trimmed) return;
              await conversation.rename(sessionId, trimmed, selectedWorkspaceRoot || undefined);
              await refreshRouteState();
            }
          : undefined
      }
      onDeleteSession={
        client && selectedWorkspaceId && activeEngineId !== DEEPSEEK_HARNESS_ENGINE_ID
          ? async (sessionId) => {
              const endpoint = endpointForWorkspace(selectedWorkspace);
              if (!endpoint) return;
              await endpoint.client.deleteSession(endpoint.workspaceId, sessionId);
              forgetProjectBuilderSession(selectedWorkspaceId, sessionId);
              useDesignAiSelectionStore.getState().resetSession(sessionId);
              if (selectedSessionId === sessionId) {
                writeLastSessionFor(selectedWorkspaceId, null);
                navigateToWorkspaceSession(selectedWorkspaceId);
              }
              await refreshRouteState();
            }
          : undefined
      }
      onArchiveSession={conversation ? handleArchiveSession : undefined}
      notFoundMessage={routeNotFoundMessage}
      onAccessibleTargetsChange={setPaletteAccessibleTargets}
    />
    <IPolloWorkModelsStartupDialog
      open={iPolloWorkModelsPromo.open}
      isSignedIn={denAuth.isSignedIn}
      models={IPOLLOWORK_MODEL_PREVIEWS}
      onSubscribe={iPolloWorkModelsPromo.subscribe}
      onContinueWithout={iPolloWorkModelsPromo.continueWithout}
    />
    {firstRunLoaderActive ? <FirstRunLoader /> : null}
    <CreateRemoteWorkspaceModal
      open={remoteWorkspaceConnectionEditor.workspace !== null}
      onClose={remoteWorkspaceConnectionEditor.close}
      onConfirm={(input) => void remoteWorkspaceConnectionEditor.save(input)}
      initialValues={remoteWorkspaceConnectionEditor.initialValues}
      submitting={remoteWorkspaceConnectionEditor.busy}
      error={remoteWorkspaceConnectionEditor.error}
      title={t("dashboard.edit_remote_workspace_title")}
      subtitle={t("dashboard.edit_remote_workspace_subtitle")}
      confirmLabel={t("dashboard.edit_remote_workspace_confirm")}
    />
    <CommandPalette
      open={commandPaletteOpen}
      onClose={() => setCommandPaletteOpen(false)}
      onCreateNewSession={() => {
        if (selectedWorkspaceId) {
          openNewTaskInWorkspace(selectedWorkspaceId);
        }
      }}
      onOpenSession={(workspaceId, sessionId) => {
        writeActiveWorkspaceId(workspaceId);
        writeLastSessionFor(workspaceId, sessionId);
        navigateToWorkspaceSession(workspaceId, sessionId);
      }}
      onOpenSettings={(route) => handleOpenSettings(route ?? "/settings/preferences")}
      onOpenHelp={handleOpenHelp}
      onOpenModelPicker={() => {
        modelPicker.setQuery("");
        modelPicker.setRecentProviderIds(new Set());
        window.requestAnimationFrame(() => modelPicker.setOpen(true));
      }}
      selectedModelLabel={modelLabel}
      accessibleTargets={paletteAccessibleTargets}
      onOpenAccessibleTarget={(target) => {
        try {
          window.dispatchEvent(new CustomEvent("ipollowork-open-accessible-target", { detail: target }));
        } catch {
          // ignore event dispatch failures
        }
      }}
      onHideAccessibleTarget={(target) => {
        try {
          window.dispatchEvent(new CustomEvent("ipollowork-hide-accessible-target", { detail: target }));
        } catch {
          // ignore event dispatch failures
        }
      }}
      sessions={paletteSessionOptions}
      extraItems={[...(sessionFindPaletteItem ? [sessionFindPaletteItem] : []), sessionSearchPaletteItem, ...terminalPaletteItems, developerModePaletteItem, diagnosticsCopyPaletteItem, diagnosticsExportPaletteItem, reloadConfigPaletteItem]}
      listModes={listModes}
      modeSelectionDisabled={modeSelectionLocked}
      selectedMode={selectedMode}
      onSelectMode={setSelectedMode}
    />
    <SessionSearchDialog
      open={sessionSearchOpen}
      onClose={() => setSessionSearchOpen(false)}
      sessions={paletteSessionOptions}
      fetchMessages={sessionSearchFetcher}
      onOpenSession={(workspaceId, sessionId) => {
        writeActiveWorkspaceId(workspaceId);
        writeLastSessionFor(workspaceId, sessionId);
        navigateToWorkspaceSession(workspaceId, sessionId);
      }}
    />
    <ModelPickerModal
      open={modelPicker.open}
      options={modelPicker.options}

      query={modelPicker.query}
      setQuery={modelPicker.setQuery}
      target="default"
      current={activeSelectedModel ?? ({ providerID: "", modelID: "" } satisfies ModelRef)}
      onSelect={(next: ModelRef) => {
        setSelectedModel(next);
        modelPicker.setOpen(false);
        focusPromptSoon();
      }}
      onConnectProvider={(providerId) => {
        modelPicker.setOpen(false);
        void sessionProviderAuthStore.openProviderAuthModal({
          returnFocusTarget: "composer",
          preferredProviderId: providerId,
        });
      }}
      disabledProviders={hiddenProviderIds}
      onBehaviorChange={() => {}}
      onToggleProvider={async (providerId, enable) => {
        if (!sharedProviderClient) return;
        try {
          const adapter = providerEngineAdapters.get(sharedProviderEngineId);
          if (!adapter.capabilities.disabledProviders) return;
          const connection = adapter.connect(sharedProviderClient);
          const current = await connection.readDisabledProviders();
          const next = enable
            ? current.filter((id: string) => id !== providerId)
            : [...current, providerId];
          await connection.writeDisabledProviders(next);
          setDisabledProviderIds(next);
        } catch {}
      }}
      onOpenSettings={() => {
        modelPicker.setOpen(false);
        handleOpenSettings("/settings/preferences");
      }}
      onClose={() => { modelPicker.setOpen(false); modelPicker.setRecentProviderIds(new Set()); }}
    />
    </WorkspaceProvider>
  );
}
