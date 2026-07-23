// Shared pure helpers for the workspace-scoped routes (session-route,
// settings-route). These were duplicated in both route files and had drifted:
// settings-route was missing the remote-workspace clobber fix in
// mergeRouteWorkspaces and used older session-status logic. One copy now.

import type { Session } from "@opencode-ai/sdk/v2/client";

import type { iPolloWorkWorkspaceInfo } from "@/app/lib/ipollowork-server";
import type { WorkspaceInfo } from "@/app/lib/desktop-types";
import type { WorkspaceSessionGroup } from "@/app/types";
import {
  normalizeDirectoryPath,
  normalizeSessionStatus,
  safeStringify,
} from "@/app/utils";
import { getDisplaySessionTitle } from "@/app/lib/session-title";
import { t } from "@/i18n";

export type RouteWorkspace = iPolloWorkWorkspaceInfo & {
  displayNameResolved: string;
};

/**
 * Sessions as the routes handle them: SDK sessions from
 * ipollowork-server's listSessions, optionally enriched with run-status
 * fields that the sidebar probes defensively via getSessionStatus.
 */
export type RouteSession = Session & {
  agent?: string;
  status?: unknown;
  state?: unknown;
  runStatus?: unknown;
  slug?: string | null;
};

export function mapDesktopWorkspace(workspace: WorkspaceInfo): RouteWorkspace {
  return {
    ...workspace,
    displayNameResolved:
      workspace.displayName?.trim() ||
      workspace.name?.trim() ||
      workspace.path?.trim() ||
      t("session.workspace_fallback"),
  };
}

export function workspaceLabel(workspace: iPolloWorkWorkspaceInfo) {
  return (
    workspace.displayName?.trim() ||
    workspace.ipolloworkWorkspaceName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    t("session.workspace_fallback")
  );
}

export function workspaceExportFilename(workspace: iPolloWorkWorkspaceInfo) {
  const slug = workspaceLabel(workspace).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "workspace"}-ipollowork-export.json`;
}

export function downloadWorkspaceJson(filename: string, payload: unknown) {
  if (typeof document === "undefined") return;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

export function isTransientStartupError(message: string | null | undefined) {
  const value = (message ?? "").toLowerCase();
  return (
    value.includes("timed out") ||
    value.includes("failed to fetch") ||
    value.includes("connection") ||
    value.includes("not ready")
  );
}

export function describeRouteError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : t("app.unknown_error");
}

export function describeWorkspaceCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("operation timed out") ||
    lower.includes("os error 60") ||
    lower.includes("etimedout")
  ) {
    return `${message}\n\niPolloWork could not read the workspace config before the filesystem timed out. This often happens when the folder is still syncing from iCloud Drive or another remote folder. Wait for the folder to finish downloading, move the workspace to a local folder, or try again.`;
  }
  return message;
}

export function mergeRouteWorkspaces(
  serverWorkspaces: iPolloWorkWorkspaceInfo[],
  desktopWorkspaces: RouteWorkspace[],
): RouteWorkspace[] {
  const desktopById = new Map(desktopWorkspaces.map((workspace) => [workspace.id, workspace]));
  const desktopByPath = new Map(
    desktopWorkspaces.flatMap((workspace) => {
      const path = normalizeDirectoryPath(workspace.path ?? "");
      return path ? [[path, workspace] as const] : [];
    }),
  );

  // If a server workspace's id matches a desktop workspace marked as remote,
  // skip the server's view entirely. The local iPolloWork server may have stale
  // registrations from earlier (buggy) activate calls that show up here as
  // `workspaceType: "local"`, which would otherwise clobber the desktop's
  // remote routing fields and send workspace-scoped requests back to the
  // local server.
  const remoteDesktopIds = new Set(
    desktopWorkspaces.flatMap((workspace) => workspace.workspaceType === "remote" ? [workspace.id] : []),
  );
  const filteredServer = serverWorkspaces.filter((workspace) => !remoteDesktopIds.has(workspace.id));

  const mergedServer = filteredServer.map((workspace) => {
    const match =
      desktopById.get(workspace.id) ??
      desktopByPath.get(normalizeDirectoryPath(workspace.path ?? ""));
    // For local workspaces, prefer the server's view (which knows things like
    // `path` and per-workspace runtime fields) and only fall back to the
    // desktop's display name when the server doesn't provide one.
    const merged = match
      ? {
          ...workspace,
          displayName: workspace.displayName?.trim()
            ? workspace.displayName
            : match.displayName,
          name: match.name?.trim() ? match.name : workspace.name,
        }
      : workspace;
    return {
      ...merged,
      displayNameResolved: workspaceLabel(merged),
    };
  });

  const mergedIds = new Set(mergedServer.map((workspace) => workspace.id));
  const mergedPaths = new Set(
    mergedServer.flatMap((workspace) => {
      const path = normalizeDirectoryPath(workspace.path ?? "");
      return path ? [path] : [];
    }),
  );
  const hasServerLocalWorkspace = filteredServer.some((workspace) => workspace.workspaceType === "local");

  const missingDesktop = desktopWorkspaces.filter((workspace) => {
    if (mergedIds.has(workspace.id)) return false;
    const normalizedPath = normalizeDirectoryPath(workspace.path ?? "");
    if (normalizedPath && mergedPaths.has(normalizedPath)) return false;
    // A running local server has its own persisted workspace registry. A
    // desktop-only local record cannot be addressed by that server, so showing
    // it here would make the shell fetch a guaranteed 404. Remote workspaces
    // remain desktop-owned and must stay visible.
    if (hasServerLocalWorkspace && workspace.workspaceType === "local") return false;
    return true;
  });

  return [...mergedServer, ...missingDesktop];
}

export function resolveKnownWorkspaceId(
  workspaces: Array<Pick<RouteWorkspace, "id">>,
  candidates: Array<string | null | undefined>,
) {
  const knownIds = new Set(workspaces.map((workspace) => workspace.id));
  for (const candidate of candidates) {
    const id = candidate?.trim() ?? "";
    if (id && knownIds.has(id)) return id;
  }
  return "";
}

export function isInternalSubtaskSession(session: RouteSession) {
  const parentID = session.parentID?.trim() ?? "";
  const agent = session.agent ?? "";
  return Boolean(parentID && agent.trim() && agent !== "orchestrator");
}

export function userVisibleSessionsByWorkspaceId(
  sessionsByWorkspaceId: Record<string, RouteSession[]>,
): Record<string, RouteSession[]> {
  return Object.fromEntries(
    Object.entries(sessionsByWorkspaceId).map(([workspaceId, sessions]) => [
      workspaceId,
      sessions.filter((session) => !isInternalSubtaskSession(session)),
    ]),
  );
}

export type TaskPaletteSessionOption = {
  workspaceId: string;
  sessionId: string;
  title: string;
  workspaceTitle: string;
  updatedAt: number;
  searchText: string;
  isActive: boolean;
};

export function buildTaskPaletteSessionOptions(
  workspaces: RouteWorkspace[],
  sessionsByWorkspaceId: Record<string, RouteSession[]>,
  selectedWorkspaceId: string,
): TaskPaletteSessionOption[] {
  const visibleSessionsByWorkspaceId = userVisibleSessionsByWorkspaceId(sessionsByWorkspaceId);
  const options: TaskPaletteSessionOption[] = [];

  for (const workspace of workspaces) {
    const workspaceTitle = workspaceLabel(workspace);
    for (const session of visibleSessionsByWorkspaceId[workspace.id] ?? []) {
      const sessionId = session.id?.trim() ?? "";
      if (!sessionId) continue;
      const title = getDisplaySessionTitle(session.title ?? "");
      const updatedAt = session.time?.updated ?? session.time?.created ?? 0;
      options.push({
        workspaceId: workspace.id,
        sessionId,
        title,
        workspaceTitle,
        updatedAt,
        searchText: `${title} ${workspaceTitle}`.toLowerCase(),
        isActive: workspace.id === selectedWorkspaceId,
      });
    }
  }

  return options.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function orderRouteWorkspaces(workspaces: RouteWorkspace[], orderIds: string[]): RouteWorkspace[] {
  if (orderIds.length === 0) return workspaces;

  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const ordered: RouteWorkspace[] = [];
  const usedIds = new Set<string>();

  for (const id of orderIds) {
    const workspace = workspaceById.get(id);
    if (!workspace || usedIds.has(id)) continue;
    ordered.push(workspace);
    usedIds.add(id);
  }

  for (const workspace of workspaces) {
    if (usedIds.has(workspace.id)) continue;
    ordered.push(workspace);
  }

  return ordered;
}

export function toSessionGroups(
  workspaces: RouteWorkspace[],
  sessionsByWorkspaceId: Record<string, RouteSession[]>,
  errorsByWorkspaceId: Record<string, string | null>,
  loadingWorkspaceIds: Set<string>,
): WorkspaceSessionGroup[] {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: sessionsByWorkspaceId[workspace.id] ?? [],
    status: loadingWorkspaceIds.has(workspace.id)
      ? "loading"
      : errorsByWorkspaceId[workspace.id]
        ? "error"
        : "ready",
    error: errorsByWorkspaceId[workspace.id],
  }));
}

export function isActiveSessionStatus(status: unknown) {
  return status === "running" || status === "retry" || status === "busy" || status === "streaming";
}

export function getSessionStatus(session: RouteSession | null | undefined) {
  const status = session?.status ?? session?.state ?? session?.runStatus ?? null;
  return typeof status === "string" ? status : normalizeSessionStatus(status);
}
