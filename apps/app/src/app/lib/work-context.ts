import {
  getDesktopHomeDir,
  ipolloworkServerInfo,
  joinDesktopPath,
  workspaceBootstrap,
  workspaceCreate,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type WorkspaceInfo,
} from "./desktop";
import {
  readEnterpriseConnections,
  type EnterpriseConnection,
} from "./enterprise-connections";
import { createiPolloWorkServerClient } from "./ipollowork-server";
import { isDesktopRuntime } from "./runtime-env";

export const PERSONAL_WORK_CONTEXT_ID = "personal" as const;
export type WorkContextId = typeof PERSONAL_WORK_CONTEXT_ID | `enterprise:${string}`;

const ACTIVE_WORK_CONTEXT_KEY = "ipollowork.work-context.v1";
const LAST_WORKSPACE_BY_CONTEXT_KEY = "ipollowork.work-context-workspaces.v1";
const LEGACY_ACTIVE_ENTERPRISE_KEY = "ipollowork.enterprise-active.v1";

export const workContextChangedEvent = "ipollowork:work-context-changed";
export const workContextSwitchEvent = "ipollowork:work-context-switch";

type WorkContextSwitchDetail = {
  phase: "start" | "finish";
  contextId: WorkContextId;
};

export function enterpriseWorkContextId(enterpriseId: string): `enterprise:${string}` {
  return `enterprise:${enterpriseId.trim()}`;
}

export function normalizeWorkContextId(value: unknown): WorkContextId | null {
  if (value === PERSONAL_WORK_CONTEXT_ID) return PERSONAL_WORK_CONTEXT_ID;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^enterprise:ent_[A-Za-z0-9_-]+$/.test(normalized)
    ? normalized as `enterprise:${string}`
    : null;
}

function legacyActiveEnterpriseId(): string | null {
  if (typeof window === "undefined") return null;
  const enterpriseId = window.localStorage.getItem(LEGACY_ACTIVE_ENTERPRISE_KEY)?.trim() ?? "";
  if (!enterpriseId || !readEnterpriseConnections().some((connection) => connection.id === enterpriseId)) return null;
  return enterpriseId;
}

export function readActiveWorkContextId(): WorkContextId {
  if (typeof window === "undefined") return PERSONAL_WORK_CONTEXT_ID;
  const stored = normalizeWorkContextId(window.localStorage.getItem(ACTIVE_WORK_CONTEXT_KEY));
  if (stored) {
    if (
      stored !== PERSONAL_WORK_CONTEXT_ID
      && !readEnterpriseConnections().some((connection) => enterpriseWorkContextId(connection.id) === stored)
    ) {
      window.localStorage.setItem(ACTIVE_WORK_CONTEXT_KEY, PERSONAL_WORK_CONTEXT_ID);
      return PERSONAL_WORK_CONTEXT_ID;
    }
    return stored;
  }

  const legacyEnterpriseId = legacyActiveEnterpriseId();
  const migrated = legacyEnterpriseId
    ? enterpriseWorkContextId(legacyEnterpriseId)
    : PERSONAL_WORK_CONTEXT_ID;
  window.localStorage.setItem(ACTIVE_WORK_CONTEXT_KEY, migrated);
  window.localStorage.removeItem(LEGACY_ACTIVE_ENTERPRISE_KEY);
  return migrated;
}

export function readActiveEnterpriseConnection(): EnterpriseConnection | null {
  const contextId = readActiveWorkContextId();
  if (contextId === PERSONAL_WORK_CONTEXT_ID) return null;
  const enterpriseId = contextId.slice("enterprise:".length);
  return readEnterpriseConnections().find((connection) => connection.id === enterpriseId) ?? null;
}

function readLastWorkspaceMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LAST_WORKSPACE_BY_CONTEXT_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([contextId, workspaceId]) => (
      normalizeWorkContextId(contextId) && typeof workspaceId === "string" && workspaceId.trim()
        ? [[contextId, workspaceId.trim()]]
        : []
    )));
  } catch {
    return {};
  }
}

export function readLastWorkspaceForWorkContext(contextId: WorkContextId): string | null {
  return readLastWorkspaceMap()[contextId] ?? null;
}

export function rememberWorkspaceForWorkContext(contextId: WorkContextId, workspaceId: string | null) {
  if (typeof window === "undefined") return;
  const map = readLastWorkspaceMap();
  const normalized = workspaceId?.trim() ?? "";
  if (normalized) map[contextId] = normalized;
  else delete map[contextId];
  window.localStorage.setItem(LAST_WORKSPACE_BY_CONTEXT_KEY, JSON.stringify(map));
}

export function workspaceBelongsToWorkContext(
  workspace: Pick<WorkspaceInfo, "workContextId">,
  contextId: WorkContextId,
): boolean {
  const workspaceContextId = normalizeWorkContextId(workspace.workContextId);
  return contextId === PERSONAL_WORK_CONTEXT_ID
    ? workspaceContextId === null || workspaceContextId === PERSONAL_WORK_CONTEXT_ID
    : workspaceContextId === contextId;
}

export function filterWorkspacesForWorkContext<T extends Pick<WorkspaceInfo, "workContextId">>(
  workspaces: T[],
  contextId: WorkContextId,
): T[] {
  return workspaces.filter((workspace) => workspaceBelongsToWorkContext(workspace, contextId));
}

function dispatchSwitch(phase: WorkContextSwitchDetail["phase"], contextId: WorkContextId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkContextSwitchDetail>(workContextSwitchEvent, {
    detail: { phase, contextId },
  }));
}

export function finishWorkContextSwitch(contextId: WorkContextId) {
  dispatchSwitch("finish", contextId);
}

function commitActiveContext(contextId: WorkContextId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_WORK_CONTEXT_KEY, contextId);
  window.localStorage.removeItem(LEGACY_ACTIVE_ENTERPRISE_KEY);
  window.dispatchEvent(new CustomEvent<WorkContextId>(workContextChangedEvent, { detail: contextId }));
}

async function localServerClient() {
  const info = await ipolloworkServerInfo();
  const baseUrl = info.baseUrl?.trim() ?? "";
  const token = info.ownerToken?.trim() || info.clientToken?.trim() || "";
  if (!baseUrl || !token) throw new Error("local_server_unavailable");
  return createiPolloWorkServerClient({
    baseUrl,
    token,
    hostToken: info.hostToken?.trim() || undefined,
  });
}

async function activateWorkspaceEverywhere(workspace: WorkspaceInfo) {
  if (workspace.workspaceType === "remote") {
    await workspaceSetSelected(workspace.id);
    await workspaceSetRuntimeActive(workspace.id);
    return workspace.id;
  }
  const client = await localServerClient();
  const list = await client.listWorkspaces();
  const serverWorkspaces = list.workspaces ?? list.items;
  let serverWorkspace = serverWorkspaces.find((entry) => entry.id === workspace.id || entry.path === workspace.path) ?? null;
  if (
    !serverWorkspace || serverWorkspace.workContextId !== workspace.workContextId
  ) {
    const created = await client.createLocalWorkspace({
      folderPath: workspace.path,
      name: workspace.displayName?.trim() || workspace.name,
      preset: workspace.preset || "starter",
      workContextId: workspace.workContextId,
    });
    serverWorkspace = created.workspaces.find((entry) => entry.id === workspace.id || entry.path === workspace.path) ?? null;
  }
  if (!serverWorkspace) throw new Error("work_context_workspace_unavailable");
  await client.activateWorkspace(serverWorkspace.id, { persist: true });
  await workspaceSetSelected(workspace.id);
  await workspaceSetRuntimeActive(workspace.id);
  return workspace.id;
}

export async function activatePersonalWorkContext(): Promise<string | null> {
  const contextId = PERSONAL_WORK_CONTEXT_ID;
  let committed = false;
  dispatchSwitch("start", contextId);
  try {
    if (!isDesktopRuntime()) {
      commitActiveContext(contextId);
      committed = true;
      return null;
    }
    const state = await workspaceBootstrap();
    const personalWorkspaces = filterWorkspacesForWorkContext(state.workspaces, contextId);
    const rememberedWorkspaceId = readLastWorkspaceForWorkContext(contextId);
    const workspace = personalWorkspaces.find((entry) => entry.id === rememberedWorkspaceId)
      ?? personalWorkspaces.find((entry) => entry.id === state.selectedId)
      ?? personalWorkspaces.find((entry) => entry.id === state.activeId)
      ?? personalWorkspaces[0]
      ?? null;
    if (!workspace) throw new Error("personal_workspace_unavailable");
    const workspaceId = await activateWorkspaceEverywhere(workspace);
    rememberWorkspaceForWorkContext(contextId, workspaceId);
    commitActiveContext(contextId);
    committed = true;
    return workspaceId;
  } finally {
    if (!committed) dispatchSwitch("finish", contextId);
  }
}

export async function activateEnterpriseWorkContext(connection: EnterpriseConnection): Promise<string | null> {
  const contextId = enterpriseWorkContextId(connection.id);
  let committed = false;
  dispatchSwitch("start", contextId);
  try {
    if (!isDesktopRuntime()) {
      commitActiveContext(contextId);
      committed = true;
      return null;
    }
    const state = await workspaceBootstrap();
    const rememberedWorkspaceId = readLastWorkspaceForWorkContext(contextId);
    let workspace = state.workspaces.find((entry) => entry.id === rememberedWorkspaceId && entry.workContextId === contextId)
      ?? state.workspaces.find((entry) => entry.workContextId === contextId)
      ?? null;
    if (!workspace) {
      const homeDir = await getDesktopHomeDir();
      const folderPath = await joinDesktopPath(homeDir, ".ipollowork", "work-contexts", connection.id);
      const created = await workspaceCreate({
        folderPath,
        name: connection.name,
        preset: "starter",
        workContextId: contextId,
      });
      workspace = created.workspaces.find((entry) => entry.workContextId === contextId)
        ?? created.workspaces.find((entry) => entry.path === folderPath)
        ?? null;
    }
    if (!workspace) throw new Error("enterprise_workspace_unavailable");
    const workspaceId = await activateWorkspaceEverywhere(workspace);
    rememberWorkspaceForWorkContext(contextId, workspaceId);
    commitActiveContext(contextId);
    committed = true;
    return workspaceId;
  } finally {
    if (!committed) dispatchSwitch("finish", contextId);
  }
}
