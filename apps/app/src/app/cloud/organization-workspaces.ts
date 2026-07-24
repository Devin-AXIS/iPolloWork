import type { DenOrgSummary } from "../lib/den";
import {
  workspaceBootstrap,
  workspaceForget,
  ipolloworkServerInfo,
  workspaceSetSelected,
  workspaceUpdateDisplayName,
  type iPolloWorkServerInfo,
  type WorkspaceInfo,
} from "../lib/desktop";
import { createiPolloWorkServerClient } from "../lib/ipollowork-server";
import { isDesktopRuntime } from "../utils";

const STORAGE_KEY = "ipollowork.cloud.organizationWorkspaces.v1";
const PENDING_ORGANIZATION_KEY = "ipollowork.cloud.pendingOrganization";

type OrganizationWorkspace = {
  organization: DenOrgSummary;
  workspaceId: string;
  workspacePath: string;
};

function readMappings(): Record<string, OrganizationWorkspace> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
      if (!entry || typeof entry !== "object" || !("organization" in entry) || !("workspaceId" in entry) || !("workspacePath" in entry)) return [];
      const organization = entry.organization;
      if (!organization || typeof organization !== "object" || !("id" in organization) || !("name" in organization) || !("slug" in organization) || !("role" in organization)) return [];
      if (typeof entry.workspaceId !== "string" || typeof entry.workspacePath !== "string" || typeof organization.id !== "string" || typeof organization.name !== "string" || typeof organization.slug !== "string") return [];
      if (organization.role !== "owner" && organization.role !== "admin" && organization.role !== "member") return [];
      const kind = "kind" in organization && (organization.kind === "personal" || organization.kind === "team") ? organization.kind : undefined;
      return [[id, { organization: { id: organization.id, name: organization.name, slug: organization.slug, role: organization.role, ...(kind ? { kind } : {}) }, workspaceId: entry.workspaceId, workspacePath: entry.workspacePath }]];
    }));
  } catch {
    return {};
  }
}

function writeMappings(value: Record<string, OrganizationWorkspace>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function selectedWorkspace(workspaces: WorkspaceInfo[], selectedId?: string | null) {
  return workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0] ?? null;
}

async function serverClient() {
  const info: iPolloWorkServerInfo = await ipolloworkServerInfo();
  const baseUrl = info.baseUrl?.trim() ?? "";
  const token = info.ownerToken?.trim() || info.clientToken?.trim() || "";
  if (!baseUrl || !token) throw new Error("iPolloWork 本地服务未连接");
  return createiPolloWorkServerClient({ baseUrl, token, hostToken: info.hostToken?.trim() || undefined });
}

async function ensureServerWorkspace(workspacePath: string, name: string) {
  const client = await serverClient();
  const list = await client.listWorkspaces();
  const existing = (list.workspaces ?? list.items).find((workspace) => workspace.path === workspacePath);
  if (existing) {
    await client.updateWorkspaceDisplayName(existing.id, name);
    await client.activateWorkspace(existing.id, { persist: true });
    return { list, workspace: { ...existing, displayName: name } };
  }
  const created = await client.createLocalWorkspace({ folderPath: workspacePath, name, preset: "starter" });
  const workspace = selectedWorkspace(created.workspaces, created.selectedId ?? created.activeId);
  if (!workspace) throw new Error("工作站创建失败");
  await client.updateWorkspaceDisplayName(workspace.id, name);
  await client.activateWorkspace(workspace.id, { persist: true });
  return { list: created, workspace };
}

export function organizationForWorkspace(workspaceId: string) {
  return Object.values(readMappings()).find((mapping) => mapping.workspaceId === workspaceId)?.organization ?? null;
}

export function shouldSyncOrganizationForWorkspace(organizationId: string) {
  const pending = window.sessionStorage.getItem(PENDING_ORGANIZATION_KEY);
  if (!pending) return true;
  if (pending !== organizationId) return false;
  window.sessionStorage.removeItem(PENDING_ORGANIZATION_KEY);
  return true;
}

export async function activateOrganizationWorkspace(organization: DenOrgSummary) {
  if (!isDesktopRuntime()) return null;
  window.sessionStorage.setItem(PENDING_ORGANIZATION_KEY, organization.id);
  const state = await workspaceBootstrap();
  const mappings = readMappings();
  const existing = mappings[organization.id];
  if (existing && state.workspaces.some((workspace) => workspace.id === existing.workspaceId)) {
    const ensured = await ensureServerWorkspace(existing.workspacePath, organization.name);
    await workspaceSetSelected(ensured.workspace.id);
    await workspaceUpdateDisplayName({ workspaceId: ensured.workspace.id, displayName: organization.name });
    mappings[organization.id] = { ...existing, organization, workspaceId: ensured.workspace.id };
    writeMappings(mappings);
    return ensured.workspace.id;
  }

  const current = selectedWorkspace(state.workspaces, state.selectedId ?? state.activeId);
  const hasPersonalMapping = Object.values(mappings).some((mapping) => mapping.organization.kind === "personal");
  if (organization.kind === "personal" && current && !hasPersonalMapping) {
    mappings[organization.id] = {
      organization,
      workspaceId: current.id,
      workspacePath: current.path,
    };
    writeMappings(mappings);
    await workspaceSetSelected(current.id);
    await workspaceUpdateDisplayName({ workspaceId: current.id, displayName: organization.name });
    return current.id;
  }

  const personal = Object.values(mappings).find((mapping) => mapping.organization.kind === "personal");
  const root = personal?.workspacePath || current?.path;
  if (!root) throw new Error("没有可用于创建工作站的本地目录");
  const folderPath = `${root.replace(/[\\/]+$/, "")}/.ipollowork/workstations/${organization.id}`;
  const { workspace } = await ensureServerWorkspace(folderPath, organization.name);
  await workspaceSetSelected(workspace.id);
  mappings[organization.id] = { organization, workspaceId: workspace.id, workspacePath: workspace.path };
  writeMappings(mappings);
  return workspace.id;
}

export async function removeOrganizationWorkspace(organizationId: string) {
  const mappings = readMappings();
  const mapping = mappings[organizationId];
  if (!mapping || mapping.organization.kind === "personal") return null;
  const client = await serverClient();
  await client.deleteWorkspace(mapping.workspaceId).catch(() => undefined);
  await workspaceForget(mapping.workspaceId).catch(() => undefined);
  delete mappings[organizationId];
  writeMappings(mappings);
  const personal = Object.values(mappings).find((item) => item.organization.kind === "personal");
  return personal ? activateOrganizationWorkspace(personal.organization) : null;
}
