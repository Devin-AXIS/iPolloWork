import type { WorkItem } from "@ipollowork/types/work-items";

import type { WorkspaceInfo } from "@/app/lib/desktop";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { isRemoteWorkspace, resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { t } from "@/i18n";

export type WorkEndpoint = {
  key: string;
  client: iPolloWorkServerClient;
  workspaceId: string;
  workspace: WorkspaceInfo;
  projectName: string;
};

export type WorkEndpointGroup = {
  key: string;
  client: iPolloWorkServerClient;
  endpoints: WorkEndpoint[];
};

type WorkItemListFilter = {
  workspaceIds: string[];
  from?: number;
  to?: number;
};

const MAX_LOADED_WORK_ITEMS = 1_000;

export function workProjectName(workspace: WorkspaceInfo): string {
  return workspace.displayName?.trim() || workspace.name.trim() || t("projects.title");
}

export function endpointForWorkspace(
  workspace: WorkspaceInfo,
  environmentClient: iPolloWorkServerClient | null,
): WorkEndpoint | null {
  if (!isRemoteWorkspace(workspace)) {
    if (!environmentClient) return null;
    return {
      key: `local:${environmentClient.baseUrl}`,
      client: environmentClient,
      workspaceId: workspace.id,
      workspace,
      projectName: workProjectName(workspace),
    };
  }
  const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: null, token: null });
  if (!endpoint) return null;
  return {
    key: `remote:${workspace.id}`,
    client: endpoint.client,
    workspaceId: endpoint.workspaceId,
    workspace,
    projectName: workProjectName(workspace),
  };
}

export function groupWorkEndpoints(endpoints: WorkEndpoint[]): WorkEndpointGroup[] {
  const groups = new Map<string, WorkEndpointGroup>();
  for (const endpoint of endpoints) {
    const existing = groups.get(endpoint.key);
    if (existing) {
      existing.endpoints.push(endpoint);
    } else {
      groups.set(endpoint.key, { key: endpoint.key, client: endpoint.client, endpoints: [endpoint] });
    }
  }
  return Array.from(groups.values());
}

export async function listEndpointWorkItems(
  client: iPolloWorkServerClient,
  filter: WorkItemListFilter,
): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.listWorkItems({
      ...filter,
      cursor,
      limit: Math.min(200, MAX_LOADED_WORK_ITEMS - items.length),
    });
    items.push(...response.items);
    cursor = response.nextCursor ?? undefined;
  } while (cursor && items.length < MAX_LOADED_WORK_ITEMS);
  return items;
}
