import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const SIDEBAR_LAYOUT_STORAGE_KEY = "ipollowork.react.sidebarLayout.v1";
export const PERSONAL_SIDEBAR_CONTEXT_ID = "personal";

export type SidebarLayoutSnapshot = {
  projectOrderByContext: Record<string, string[]>;
  sessionOrderByProject: Record<string, string[]>;
  sessionProjectByKey: Record<string, string>;
};

export type SidebarLayoutState = SidebarLayoutSnapshot & {
  reorderProjects: (contextId: string, sourceId: string, targetId: string) => void;
  moveSession: (sessionKey: string, targetProjectId: string) => void;
  reorderSessions: (projectId: string, sourceKey: string, targetKey: string) => void;
  prune: (input: {
    contextId: string;
    projectIds: string[];
    sessionKeys: string[];
    sourceProjectBySessionKey?: Record<string, string>;
  }) => void;
};

const EMPTY_LAYOUT: SidebarLayoutSnapshot = {
  projectOrderByContext: {},
  sessionOrderByProject: {},
  sessionProjectByKey: {},
};

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function cleanMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, ids]) => {
      const normalizedKey = key.trim();
      const normalizedIds = cleanIds(ids);
      return normalizedKey && normalizedIds.length > 0 ? [[normalizedKey, normalizedIds]] : [];
    }),
  );
}

function cleanAssignmentMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, target]) => {
      const normalizedKey = key.trim();
      const normalizedTarget = typeof target === "string" ? target.trim() : "";
      return normalizedKey && normalizedTarget ? [[normalizedKey, normalizedTarget]] : [];
    }),
  );
}

export function createSidebarLayoutSnapshot(): SidebarLayoutSnapshot {
  return {
    projectOrderByContext: {},
    sessionOrderByProject: {},
    sessionProjectByKey: {},
  };
}

export function normalizeSidebarLayout(value: unknown): SidebarLayoutSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createSidebarLayoutSnapshot();
  const record = value as Record<string, unknown>;
  return {
    projectOrderByContext: cleanMap(record.projectOrderByContext),
    sessionOrderByProject: cleanMap(record.sessionOrderByProject),
    sessionProjectByKey: cleanAssignmentMap(record.sessionProjectByKey),
  };
}

export function sessionLayoutKey(sourceWorkspaceId: string, sessionId: string): string {
  return `${sourceWorkspaceId.trim()}\u0000${sessionId.trim()}`;
}

function reorderIds(ids: string[], sourceId: string, targetId: string): string[] {
  const source = sourceId.trim();
  const target = targetId.trim();
  if (!source || !target || source === target) return ids;
  const next = ids.filter((id) => id !== source);
  const targetIndex = next.indexOf(target);
  if (targetIndex < 0) return [...next, source];
  next.splice(targetIndex, 0, source);
  return next;
}

function upsertOrder(
  map: Record<string, string[]>,
  key: string,
  sourceId: string,
  targetId: string,
): Record<string, string[]> {
  const normalizedKey = key.trim();
  if (!normalizedKey) return map;
  const existing = cleanIds(map[normalizedKey]);
  const source = sourceId.trim();
  const target = targetId.trim();
  const seeded = existing.length === 0
    ? [source, target]
    : [...existing, ...[source, target].filter((id) => id && !existing.includes(id))];
  const next = reorderIds(seeded, sourceId, targetId);
  if (existing.length === next.length && existing.every((id, index) => id === next[index])) return map;
  return { ...map, [normalizedKey]: next };
}

export const useSidebarLayoutStore = create<SidebarLayoutState>()(
  persist(
    (set) => ({
      ...createSidebarLayoutSnapshot(),
      reorderProjects: (contextId, sourceId, targetId) => set((state) => ({
        projectOrderByContext: upsertOrder(state.projectOrderByContext, contextId, sourceId, targetId),
      })),
      moveSession: (sessionKey, targetProjectId) => set((state) => {
        const key = sessionKey.trim();
        const target = targetProjectId.trim();
        if (!key || !target || state.sessionProjectByKey[key] === target) return state;
        return {
          sessionProjectByKey: { ...state.sessionProjectByKey, [key]: target },
        };
      }),
      reorderSessions: (projectId, sourceKey, targetKey) => set((state) => ({
        sessionOrderByProject: upsertOrder(state.sessionOrderByProject, projectId, sourceKey, targetKey),
      })),
      prune: ({ contextId, projectIds, sessionKeys, sourceProjectBySessionKey }) => set((state) => {
        const knownProjects = new Set(cleanIds(projectIds));
        const knownSessions = new Set(cleanIds(sessionKeys));
        const context = contextId.trim();
        const projectOrder = cleanIds(state.projectOrderByContext[context]).filter((id) => knownProjects.has(id));
        const projectOrderByContext = { ...state.projectOrderByContext };
        if (context) {
          if (projectOrder.length > 0) projectOrderByContext[context] = projectOrder;
          else delete projectOrderByContext[context];
        }

        const sessionOrderByProject = Object.fromEntries(
          Object.entries(state.sessionOrderByProject).flatMap(([projectId, ids]) => {
            if (!knownProjects.has(projectId)) return [];
            const next = cleanIds(ids).filter((id) => knownSessions.has(id));
            return next.length > 0 ? [[projectId, next]] : [];
          }),
        );
        const sessionProjectByKey = Object.fromEntries(
          Object.entries(state.sessionProjectByKey).flatMap(([key, projectId]) => {
            if (!knownSessions.has(key) || !knownProjects.has(projectId)) return [];
            return [[key, projectId]];
          }),
        );
        for (const key of knownSessions) {
          const sourceProject = sourceProjectBySessionKey?.[key]?.trim();
          if (!sourceProject) continue;
          if (!sessionProjectByKey[key]) sessionProjectByKey[key] = sourceProject;
        }

        const unchanged = JSON.stringify({ projectOrderByContext, sessionOrderByProject, sessionProjectByKey })
          === JSON.stringify({
            projectOrderByContext: state.projectOrderByContext,
            sessionOrderByProject: state.sessionOrderByProject,
            sessionProjectByKey: state.sessionProjectByKey,
          });
        return unchanged ? state : { projectOrderByContext, sessionOrderByProject, sessionProjectByKey };
      }),
    }),
    {
      name: SIDEBAR_LAYOUT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        projectOrderByContext: state.projectOrderByContext,
        sessionOrderByProject: state.sessionOrderByProject,
        sessionProjectByKey: state.sessionProjectByKey,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeSidebarLayout(persisted),
      }),
    },
  ),
);
