/**
 * Thin localStorage wrapper for the React shell's "remember what the user had
 * open" behavior. Keys mirror those the Solid app used so users don't lose
 * their spot when switching between shells during the port.
 */

import type { RouteSession } from "./route-workspaces";

const ACTIVE_WORKSPACE_KEY = "ipollowork.react.activeWorkspace";
const SESSION_BY_WORKSPACE_KEY = "ipollowork.react.sessionByWorkspace";
const LEGACY_WORKSPACE_ORDER_KEY = "ipollowork.react.workspaceOrder";
const WORKSPACE_PROJECT_DIMENSION_KEY = "ipollowork.react.workspaceProjectDimension";
const SESSION_DIRECTORY_CACHE_KEY = "ipollowork.react.sessionDirectory";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === "") {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (quota, privacy modes, etc.)
  }
}

export function readActiveWorkspaceId(): string | null {
  return safeGet(ACTIVE_WORKSPACE_KEY)?.trim() || null;
}

export function writeActiveWorkspaceId(id: string | null): void {
  const normalized = id?.trim() || null;
  safeSet(ACTIVE_WORKSPACE_KEY, normalized);
}

type SessionByWorkspace = Record<string, string>;
export type WorkspaceProjectDimension = {
  label: string;
};

function readSessionByWorkspaceMap(): SessionByWorkspace {
  const raw = safeGet(SESSION_BY_WORKSPACE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: SessionByWorkspace = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key === "string" && typeof value === "string") {
          result[key] = value;
        }
      }
      return result;
    }
  } catch {
    // ignore malformed payload
  }
  return {};
}

export function readLastSessionFor(workspaceId: string): string | null {
  const id = workspaceId?.trim();
  if (!id) return null;
  return readSessionByWorkspaceMap()[id] ?? null;
}

export function writeLastSessionFor(workspaceId: string, sessionId: string | null): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionByWorkspaceMap();
  const normalized = sessionId?.trim() || "";
  if (!normalized) {
    if (!(wsId in map)) return;
    delete map[wsId];
  } else {
    if (map[wsId] === normalized) return;
    map[wsId] = normalized;
  }
  safeSet(SESSION_BY_WORKSPACE_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
}

export function readSessionDirectoryCache(): Record<string, RouteSession[]> {
  const raw = safeGet(SESSION_DIRECTORY_CACHE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, RouteSession[]> = {};
    for (const [workspaceId, value] of Object.entries(parsed)) {
      if (!workspaceId.trim() || !Array.isArray(value)) continue;
      result[workspaceId] = value.flatMap((entry): RouteSession[] => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.title !== "string") return [];
        const session: RouteSession = { id: record.id, title: record.title };
        if (typeof record.slug === "string") session.slug = record.slug;
        if (typeof record.parentID === "string") session.parentID = record.parentID;
        if (typeof record.directory === "string") session.directory = record.directory;
        if (typeof record.agent === "string") session.agent = record.agent;
        if (record.time && typeof record.time === "object" && !Array.isArray(record.time)) {
          const time = record.time as Record<string, unknown>;
          session.time = {
            ...(typeof time.created === "number" ? { created: time.created } : {}),
            ...(typeof time.updated === "number" ? { updated: time.updated } : {}),
            ...(typeof time.archived === "number" ? { archived: time.archived } : {}),
          };
        }
        return [session];
      }).slice(0, 200);
    }
    return result;
  } catch {
    return {};
  }
}

export function writeSessionDirectoryCache(sessionsByWorkspaceId: Record<string, RouteSession[]>): void {
  const compact = Object.fromEntries(Object.entries(sessionsByWorkspaceId).map(([workspaceId, sessions]) => [
    workspaceId,
    sessions.slice(0, 200).map((session) => ({
      id: session.id,
      title: session.title,
      ...(session.slug ? { slug: session.slug } : {}),
      ...(session.parentID ? { parentID: session.parentID } : {}),
      ...(session.directory ? { directory: session.directory } : {}),
      ...(session.agent ? { agent: session.agent } : {}),
      ...(session.time ? { time: session.time } : {}),
    })),
  ]));
  safeSet(SESSION_DIRECTORY_CACHE_KEY, Object.keys(compact).length ? JSON.stringify(compact) : null);
}

function readWorkspaceProjectDimensionMap(): Record<string, WorkspaceProjectDimension> {
  const raw = safeGet(WORKSPACE_PROJECT_DIMENSION_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, WorkspaceProjectDimension> = {};
    for (const [workspaceId, value] of Object.entries(parsed)) {
      if (!workspaceId.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      if (!label) continue;
      result[workspaceId] = {
        label,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function readWorkspaceProjectDimension(workspaceId: string | null | undefined): WorkspaceProjectDimension | null {
  const wsId = workspaceId?.trim();
  if (!wsId) return null;
  return readWorkspaceProjectDimensionMap()[wsId] ?? null;
}

export function writeWorkspaceProjectDimension(
  workspaceId: string | null | undefined,
  dimension: WorkspaceProjectDimension | null,
): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readWorkspaceProjectDimensionMap();
  const label = dimension?.label.trim() ?? "";
  if (!label) {
    delete map[wsId];
  } else {
    map[wsId] = {
      label,
    };
  }
  safeSet(WORKSPACE_PROJECT_DIMENSION_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
}

// Provider/org onboarding flags owned elsewhere but cleared together with the
// workspace-memory keys so a "reset onboarding" (Settings → Recovery) or a
// recovery-disabled dev launch produces a genuinely fresh first run.
const ONBOARDING_FLAG_KEYS = [
  "ipollowork.acknowledgedProviders",
  "ipollowork.orgOnboardingSeen",
  "ipollowork.reloadAfterOrgOnboarding",
  "ipollowork.seenProviderIds",
];
const PREFERENCES_KEY = "ipollowork.preferences";

/**
 * Clear every renderer signal that marks this profile as "already onboarded".
 * Non-`all` reset paths previously left ACTIVE_WORKSPACE_KEY and
 * SESSION_BY_WORKSPACE_KEY behind, which silently suppressed the whole
 * first-run flow (the loader keys off active-workspace memory; auto-create and
 * the loader-dismiss check key off last-session memory).
 */
export function resetFirstRunClientState(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of [
      ACTIVE_WORKSPACE_KEY,
      SESSION_BY_WORKSPACE_KEY,
      SESSION_DIRECTORY_CACHE_KEY,
      LEGACY_WORKSPACE_ORDER_KEY,
      WORKSPACE_PROJECT_DIMENSION_KEY,
      ...ONBOARDING_FLAG_KEYS,
    ]) {
      window.localStorage.removeItem(key);
    }
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      const prefs = JSON.parse(raw) as Record<string, unknown>;
      prefs.hasCompletedOnboarding = false;
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    }
  } catch {
    // ignore storage errors (quota, privacy modes, etc.)
  }
}
