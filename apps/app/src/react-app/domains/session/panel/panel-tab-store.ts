import { artifactPathMatchesTarget } from "@/lib/artifacts";
import { mediaKindForPath, safeVideoMediaPath } from "@ipollowork/types/video-image-workbench";
import type { MediaWorkbenchSource } from "@/react-app/plugin-ui/media-workbench";
import type { DesignMedia } from "../design/design-media";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { isCollectibleArtifactTarget, type OpenTarget, type OpenTargetPreview } from "../artifacts/open-target";
import type { PluginUiSurface } from "@/react-app/plugin-ui/plugin-ui-contributions";
import type { PluginUiHostContextV1 } from "@ipollowork/types/plugins";

export const PERSISTED_PANEL_TAB_STORE_KEY = "ipollowork:panel-tabs:v1";

export type PanelTabType = "artifact" | "browser" | "design" | "video" | "workspace-app" | "plugin-studio";

export type { BrowserPanelTab } from "../../../../app/lib/desktop-types";
import type { BrowserPanelTab } from "../../../../app/lib/desktop-types";

export type ArtifactPanelTab = {
  id: string;
  type: "artifact";
  label: string;
  preview: OpenTargetPreview;
  target?: OpenTarget;
}

export type DesignPanelTab = {
  id: string;
  type: "design";
  label: string;
  sessionId: string;
  path?: string;
};

export type VideoPanelTab = {
  id: string;
  type: "video";
  label: string;
  sessionId: string;
};

export type WorkspaceAppPanelTab = {
  mediaEditRequestId?: string;
  id: string;
  type: "workspace-app";
  label: string;
  sessionId: string;
  surface: PluginUiSurface;
  launch?: PluginUiHostContextV1["launch"];
};

export type PluginStudioPanelTab = {
  id: string;
  type: "plugin-studio";
  label: string;
  sessionId: string;
  pluginId?: string;
  creationBaselinePluginIds?: string[];
};

export type PanelTab = BrowserPanelTab | ArtifactPanelTab | DesignPanelTab | VideoPanelTab | WorkspaceAppPanelTab | PluginStudioPanelTab;

export type SessionPanelState = {
  tabs: PanelTab[];
  activeTabId: string | null;
};

type PersistedPanelTabRef = {
  id: string;
  type: PanelTabType;
  label?: string;
  pluginId?: string;
  creationBaselinePluginIds?: string[];
};

type PersistedSessionPanelState = {
  tabs: PersistedPanelTabRef[];
  activeTabId: string | null;
};

export type MediaEditBinding = {
  workspaceId: string; sessionId: string; projectSessionId: string;
  source: MediaWorkbenchSource;
  locator: string; original: string; page: string;
  media: DesignMedia;
  results: string[]; resultPath?: string; active: boolean; replaced: boolean;
};
function isMediaEditBinding(value: unknown): value is MediaEditBinding {
  const record = (item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null;
  if (!record(value) || !record(value.source) || !record(value.media)) return false;
  return [value.workspaceId,value.sessionId,value.projectSessionId,value.locator,value.original,value.page,value.source.requestId,value.source.path,value.media.source,value.media.preview].every(item => typeof item === "string")
    && (value.source.kind === "image" || value.source.kind === "video")
    && value.media.kind === value.source.kind && typeof value.media.background === "boolean"
    && typeof value.active === "boolean" && typeof value.replaced === "boolean"
    && (value.resultPath === undefined || typeof value.resultPath === "string")
    && Array.isArray(value.results) && value.results.length <= 20 && value.results.every(item => typeof item === "string");
}

type PersistedPanelTabStore = {
  mediaEdits?: unknown;
  sessions: Record<string, PersistedSessionPanelState>;
};

export type PanelTabStore = {
  mediaEdits: MediaEditBinding[];
  rememberMediaEdit: (edit: MediaEditBinding) => void;
  completeMediaEdit: (workspaceId: string, sessionId: string, requestId: string, path: string) => MediaEditBinding | null;
  openMediaEditResult: (workspaceId: string, sessionId: string, path: string, surface: PluginUiSurface) => boolean;
  resumeMediaEdit: (edit: MediaEditBinding, path: string, surface: PluginUiSurface) => void;
  closeMediaEdit: (requestId: string, replaced?: boolean) => void;
  sessions: Record<string, SessionPanelState>;
  transcriptArtifactTargets: Record<string, OpenTarget[]>;
  openTab: (sessionId: string, tab: PanelTab) => void;
  closeTab: (sessionId: string, tabId: string) => void;
  selectTab: (sessionId: string, tabId: string) => void;
  reorderTabs: (sessionId: string, tabIds: string[]) => void;
  syncBrowserTabs: (sessionId: string, browserTabs: BrowserPanelTab[], activeBrowserTabId: string | null) => void;
  syncArtifactTargets: (
    sessionId: string,
    targets: Array<{ id: string; name: string; preview: OpenTargetPreview }>,
  ) => void;
  syncTranscriptArtifacts: (sessionId: string, targets: OpenTarget[]) => void;
  clearSession: (sessionId: string) => void;
};

const EMPTY_SESSION: SessionPanelState = {
  tabs: [],
  activeTabId: null,
};

function getWritableSession(state: PanelTabStore, sessionId: string): SessionPanelState {
  return state.sessions[sessionId] ?? EMPTY_SESSION;
}

function updateSession(
  state: PanelTabStore,
  sessionId: string,
  session: SessionPanelState,
): Partial<PanelTabStore> {
  return {
    sessions: {
      ...state.sessions,
      [sessionId]: session,
    },
  };
}

function reconcileOpenArtifactTabs(
  session: SessionPanelState,
  targets: Array<{ id: string; name: string; preview: OpenTargetPreview }>,
): SessionPanelState {
  const targetMap = new Map(targets.map((target) => [target.id, target]));

  const tabs = session.tabs
    .map((tab) => {
      if (tab.type !== "artifact") {
        return tab;
      }

      const target = targetMap.get(tab.id);

      if (!target) {
        return null;
      }

      return {
        ...tab,
        label: target.name,
        preview: target.preview,
      };
    })
    .filter((tab): tab is PanelTab => tab !== null);

  return {
    tabs,
    activeTabId: resolveActiveTabId(tabs, session.activeTabId),
  };
}

function isSameTranscriptArtifactTargets(left: OpenTarget[], right: OpenTarget[]) {
  return (
    left.length === right.length &&
    left.every((target, index) => target.id === right[index]?.id)
  );
}

function resolveActiveTabId<Tab extends { id: string }>(
  tabs: Tab[],
  preferredActiveTabId: string | null,
): string | null {
  if (preferredActiveTabId && tabs.some((tab) => tab.id === preferredActiveTabId)) {
    return preferredActiveTabId;
  }

  return tabs[0]?.id ?? null;
}

function isSameTab(left: PanelTab, right: PanelTab) {
  if (left.id !== right.id || left.type !== right.type) {
    return false;
  }

  if (left.type === "artifact" && right.type === "artifact") {
    return (
      left.label === right.label &&
      left.preview === right.preview &&
      left.target?.id === right.target?.id &&
      left.target?.value === right.target?.value
    );
  }

  if (left.type === "browser" && right.type === "browser") {
    return (
      left.label === right.label &&
      left.url === right.url &&
      left.favicon === right.favicon &&
      left.status === right.status &&
      left.canGoBack === right.canGoBack &&
      left.canGoForward === right.canGoForward
    );
  }

  if (left.type === "design" && right.type === "design") {
    return left.label === right.label && left.sessionId === right.sessionId && left.path === right.path;
  }

  if (left.type === "video" && right.type === "video") {
    return left.label === right.label && left.sessionId === right.sessionId;
  }

  if (left.type === "workspace-app" && right.type === "workspace-app") {
    return left.label === right.label
      && left.sessionId === right.sessionId
      && left.mediaEditRequestId === right.mediaEditRequestId
      && left.surface.id === right.surface.id
      && JSON.stringify(left.launch) === JSON.stringify(right.launch);
  }

  if (left.type === "plugin-studio" && right.type === "plugin-studio") {
    return (
      left.label === right.label
      && left.sessionId === right.sessionId
      && left.pluginId === right.pluginId
      && JSON.stringify(left.creationBaselinePluginIds) === JSON.stringify(right.creationBaselinePluginIds)
    );
  }

  return false;
}

function decodeDesignPath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isSameSessionPanelState(
  session: SessionPanelState,
  tabs: PanelTab[],
  activeTabId: string | null,
) {
  return (
    session.tabs.length === tabs.length &&
    session.activeTabId === activeTabId &&
    session.tabs.every((tab, index) => isSameTab(tab, tabs[index]))
  );
}

function mergePersistedSessions(
  persistedState: unknown,
  currentState: PanelTabStore,
): PanelTabStore {
  const persisted = persistedState as PersistedPanelTabStore | undefined;

  if (!persisted?.sessions) {
    return currentState;
  }

  const sessions: Record<string, SessionPanelState> = {};

  for (const [sessionId, session] of Object.entries(persisted.sessions)) {
    const tabs = session.tabs
      .flatMap((persistedTab): PanelTab[] => {
        const { id, type } = persistedTab;
        if (type === "browser") {
          return [{
            id,
            type: "browser",
            label: "New tab",
            url: "",
            favicon: null,
            status: "ready",
            canGoBack: false,
            canGoForward: false,
          }];
        }
        if (type === "design") {
          const designId = id.startsWith("design:") ? id.slice("design:".length) : "";
          const separatorIndex = designId.indexOf(":");
          const sessionId = separatorIndex >= 0 ? designId.slice(0, separatorIndex) : designId;
          const encodedPath = separatorIndex >= 0 ? designId.slice(separatorIndex + 1) : "";
          const path = encodedPath ? decodeDesignPath(encodedPath) : undefined;
          const tabId = path ? id : `design:${sessionId}:entry`;
          return sessionId ? [{ id: tabId, type: "design", label: path ? path.split("/").pop() || path : "Design", sessionId, path }] : [];
        }
        if (type === "plugin-studio") {
          return [{
            id,
            type: "plugin-studio",
            label: persistedTab.label?.trim() || "插件工坊",
            sessionId,
            pluginId: persistedTab.pluginId,
            creationBaselinePluginIds: persistedTab.creationBaselinePluginIds,
          }];
        }
        return [];
      });

    sessions[sessionId] = {
      tabs,
      activeTabId: resolveActiveTabId(tabs, session.activeTabId),
    };
  }

  for (const [sessionId, currentSession] of Object.entries(currentState.sessions)) {
    const persistedSession = sessions[sessionId] ?? EMPTY_SESSION;
    const currentTabIds = new Set(currentSession.tabs.map((tab) => tab.id));
    const tabs = [
      ...persistedSession.tabs.filter((tab) => !currentTabIds.has(tab.id)),
      ...currentSession.tabs,
    ];
    sessions[sessionId] = {
      tabs,
      activeTabId: resolveActiveTabId(
        tabs,
        currentSession.activeTabId ?? persistedSession.activeTabId,
      ),
    };
  }

  return {
    ...currentState,
    mediaEdits: Array.isArray(persisted.mediaEdits) ? persisted.mediaEdits.filter(isMediaEditBinding).slice(-50) : currentState.mediaEdits,
    sessions,
  };
}

export const usePanelTabStore = create<PanelTabStore>()(
  persist(
    (set, get) => ({
      sessions: {},
      mediaEdits: [],
      rememberMediaEdit: (edit) => set(state => ({
        mediaEdits: [
          ...state.mediaEdits.filter(item => item.source.requestId !== edit.source.requestId)
            .map(item => item.workspaceId === edit.workspaceId && item.sessionId === edit.sessionId ? {...item, active: false} : item),
          edit,
        ].slice(-50),
      })),
      completeMediaEdit: (workspaceId, sessionId, requestId, path) => {
        const edit = get().mediaEdits.find(item => item.workspaceId === workspaceId
          && item.sessionId === sessionId && item.source.requestId === requestId);
        if (!edit || !safeVideoMediaPath(path) || mediaKindForPath(path) !== edit.source.kind || path === edit.source.path) return null;
        const next = {...edit, resultPath: path, results: [...edit.results.filter(value => value !== path), path].slice(-20)};
        set(state => ({mediaEdits: state.mediaEdits.map(item => item === edit ? next : item)}));
        return next;
      },
      openMediaEditResult: (workspaceId, sessionId, path, surface) => {
        const edit = [...get().mediaEdits].reverse().find(item => item.workspaceId === workspaceId
          && item.sessionId === sessionId && item.results.some(result => artifactPathMatchesTarget(path, result)));
        const resultPath = edit?.results.find(result => artifactPathMatchesTarget(path, result));
        if (!edit || !resultPath) return false;
        get().resumeMediaEdit(edit, resultPath, surface);
        return true;
      },
      resumeMediaEdit: (edit, path, surface) => {
        set(state => ({mediaEdits: state.mediaEdits.map(item => {
          if (item.workspaceId !== edit.workspaceId || item.sessionId !== edit.sessionId) return item;
          return item.source.requestId === edit.source.requestId
            ? {...item, active: true, resultPath: path}
            : {...item, active: false};
        })}));
        get().openTab(edit.sessionId, {
          id: `workspace-app:${surface.id}`, type: "workspace-app", label: surface.label,
          sessionId: edit.sessionId, surface, mediaEditRequestId: edit.source.requestId,
        });
      },
      closeMediaEdit: (requestId, replaced = false) => set(state => ({
        mediaEdits: state.mediaEdits.map(item => item.source.requestId === requestId
          ? {...item, active: false, replaced: item.replaced || replaced} : item),
      })),
      transcriptArtifactTargets: {},
      openTab: (sessionId, tab) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const existingIndex = session.tabs.findIndex((entry) => entry.id === tab.id);

        if (existingIndex >= 0) {
          const tabs = [...session.tabs];
          tabs[existingIndex] = tab;

          return updateSession(state, sessionId, {
            tabs,
            activeTabId: tab.id,
          });
        }

        return updateSession(state, sessionId, {
          tabs: [...session.tabs, tab],
          activeTabId: tab.id,
        });
      }),
      closeTab: (sessionId, tabId) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const index = session.tabs.findIndex((tab) => tab.id === tabId);
        if (index < 0) {
          return state;
        }

        const tabs = session.tabs.filter((tab) => tab.id !== tabId);
        const activeTabId = session.activeTabId === tabId
          ? resolveActiveTabId(tabs, tabs[index]?.id ?? tabs[index - 1]?.id ?? null)
          : session.activeTabId;

        return updateSession(state, sessionId, { tabs, activeTabId });
      }),
      selectTab: (sessionId, tabId) => set((state) => {
        const session = getWritableSession(state, sessionId);
        if (!session.tabs.some((tab) => tab.id === tabId)) {
          return state;
        }

        if (session.activeTabId === tabId) {
          return state;
        }

        return updateSession(state, sessionId, {
          ...session,
          activeTabId: tabId,
        });
      }),
      reorderTabs: (sessionId, tabIds) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const tabsById = new Map(session.tabs.map((tab) => [tab.id, tab]));
        const reorderedTabs = tabIds
          .map((tabId) => tabsById.get(tabId))
          .filter((tab): tab is PanelTab => Boolean(tab));

        if (reorderedTabs.length !== session.tabs.length) {
          return state;
        }

        return updateSession(state, sessionId, {
          ...session,
          tabs: reorderedTabs,
        });
      }),
      syncBrowserTabs: (sessionId, browserTabs, activeBrowserTabId) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const browserTabsById = new Map(browserTabs.map((tab) => [tab.id, tab]));

        const mergedTabs: PanelTab[] = [];

        for (const tab of session.tabs) {
          if (tab.type === "artifact" || tab.type === "design" || tab.type === "video" || tab.type === "workspace-app" || tab.type === "plugin-studio") {
            mergedTabs.push(tab);
            continue;
          }

          const browserTab = browserTabsById.get(tab.id);
          if (browserTab) {
            mergedTabs.push(browserTab);
            browserTabsById.delete(tab.id);
          }
        }

        for (const browserTab of browserTabsById.values()) {
          mergedTabs.push(browserTab);
        }

        const currentActiveTab = session.tabs.find((tab) => tab.id === session.activeTabId);
        const activeBrowserTabIsNew = Boolean(
          activeBrowserTabId && !session.tabs.some((tab) => tab.id === activeBrowserTabId),
        );
        const shouldSyncActiveFromElectron =
          !session.activeTabId || currentActiveTab?.type === "browser" || activeBrowserTabIsNew;

        const activeTabId = shouldSyncActiveFromElectron
          ? resolveActiveTabId(mergedTabs, activeBrowserTabId)
          : resolveActiveTabId(mergedTabs, session.activeTabId);

        if (isSameSessionPanelState(session, mergedTabs, activeTabId)) {
          return state;
        }

        return updateSession(state, sessionId, {
          tabs: mergedTabs,
          activeTabId,
        });
      }),
      syncArtifactTargets: (sessionId, targets) => set((state) => {
        const session = getWritableSession(state, sessionId);
        const nextSession = reconcileOpenArtifactTabs(session, targets);

        if (isSameSessionPanelState(session, nextSession.tabs, nextSession.activeTabId)) {
          return state;
        }

        return updateSession(state, sessionId, nextSession);
      }),
      syncTranscriptArtifacts: (sessionId, targets) => set((state) => {
        const currentTranscript = state.transcriptArtifactTargets[sessionId] ?? [];
        const session = getWritableSession(state, sessionId);
        const collectibleTargets = targets
          .filter(isCollectibleArtifactTarget)
          .map((target) => ({
            id: target.id,
            name: target.name,
            preview: target.preview,
          }));
        const nextSession = reconcileOpenArtifactTabs(session, collectibleTargets);
        const transcriptChanged = !isSameTranscriptArtifactTargets(currentTranscript, targets);
        const sessionChanged = !isSameSessionPanelState(session, nextSession.tabs, nextSession.activeTabId);

        if (!transcriptChanged && !sessionChanged) {
          return state;
        }

        const sessionUpdate = sessionChanged ? updateSession(state, sessionId, nextSession) : null;

        return {
          transcriptArtifactTargets: transcriptChanged ? {
            ...state.transcriptArtifactTargets,
            [sessionId]: targets,
          } : state.transcriptArtifactTargets,
          sessions: sessionUpdate?.sessions ?? state.sessions,
        };
      }),
      clearSession: (sessionId) => set((state) => {
        const nextSessions = { ...state.sessions };
        const nextTranscriptArtifactTargets = { ...state.transcriptArtifactTargets };

        let changed = false;

        if (state.sessions[sessionId]) {
          delete nextSessions[sessionId];
          changed = true;
        }

        if (state.transcriptArtifactTargets[sessionId]) {
          delete nextTranscriptArtifactTargets[sessionId];
          changed = true;
        }

        if (!changed) {
          return state;
        }

        return {
          sessions: nextSessions,
          transcriptArtifactTargets: nextTranscriptArtifactTargets,
        };
      }),
    }),
    {
      name: PERSISTED_PANEL_TAB_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mediaEdits: state.mediaEdits,
        sessions: Object.fromEntries(
          Object.entries(state.sessions).map(([sessionId, session]) => {
            const tabs = session.tabs.flatMap((tab): PersistedPanelTabRef[] => {
              if (tab.type === "browser") return [{ id: tab.id, type: tab.type }];
              if (tab.type === "plugin-studio") {
                return [{
                  id: tab.id,
                  type: tab.type,
                  label: tab.label,
                  pluginId: tab.pluginId,
                  creationBaselinePluginIds: tab.creationBaselinePluginIds,
                }];
              }
              return [];
            });

            return [
              sessionId,
              {
                tabs,
                activeTabId: resolveActiveTabId(tabs, session.activeTabId),
              },
            ];
          }),
        ),
      }),
      merge: (persistedState, currentState) => mergePersistedSessions(persistedState, currentState),
    },
  ),
);

export function useSessionPanelState(sessionId: string): SessionPanelState {
  return usePanelTabStore((state) => state.sessions[sessionId] ?? EMPTY_SESSION);
}

export function useActivePanelTab(sessionId: string): PanelTab | null {
  return usePanelTabStore((state) => {
    const session = state.sessions[sessionId] ?? EMPTY_SESSION;

    return session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? null;
  });
}
