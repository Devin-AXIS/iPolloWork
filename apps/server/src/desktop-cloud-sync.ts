export type ResourceSnapshotConfigItem = {
  configItemId: string;
  lastUpdatedAt: string;
};

export type ResourceSnapshotPlugin = {
  pluginId: string;
  lastUpdatedAt: string;
  configItems: ResourceSnapshotConfigItem[];
};

export type ResourceSnapshotMarketplace = {
  lastUpdatedAt: string;
  plugins: ResourceSnapshotPlugin[];
};

export type ResourceSnapshot = {
  organizationId: string;
  orgMemberId: string;
  teamIds: string[];
  resources: {
    llmProviders: Record<string, string>;
    marketplaces: Record<string, ResourceSnapshotMarketplace>;
  };
};

export type DesktopCloudSyncChangeKind = "new" | "modified" | "removed";
export type DesktopCloudSyncResourceKind = "llmProvider";

export type DesktopCloudSyncChange = {
  id: string;
  kind: DesktopCloudSyncChangeKind;
  resourceKind: DesktopCloudSyncResourceKind;
  previousLastUpdatedAt: string | null;
  nextLastUpdatedAt: string | null;
  queuedAt: number;
};

export type DesktopCloudSyncEntry = {
  contextKey: string;
  fetchedAt: number;
  organizationId: string;
  orgMemberId: string;
  pendingChanges: DesktopCloudSyncChange[];
  snapshot: ResourceSnapshot;
  teamIds: string[];
};

export type DesktopCloudSyncState = {
  entries: Record<string, DesktopCloudSyncEntry>;
  updatedAt: number;
  version: 1;
};

type CloudImportedProvider = {
  cloudProviderId: string;
  updatedAt: string | null;
};

type WorkspaceCloudImports = {
  providers: Record<string, CloudImportedProvider>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function readTimestampRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const id = key.trim();
    const timestampValue = typeof entry === "string" ? entry.trim() : "";
    if (id && timestampValue) {
      record[id] = timestampValue;
    }
  }
  return record;
}

function readResourceSnapshotConfigItems(value: unknown): ResourceSnapshotConfigItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const configItemId = typeof entry.configItemId === "string" ? entry.configItemId.trim() : "";
    const lastUpdatedAt = typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt.trim() : "";
    return configItemId && lastUpdatedAt ? [{ configItemId, lastUpdatedAt }] : [];
  });
}

function readResourceSnapshotPlugins(value: unknown): ResourceSnapshotPlugin[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const pluginId = typeof entry.pluginId === "string" ? entry.pluginId.trim() : "";
    const lastUpdatedAt = typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt.trim() : "";
    if (!pluginId || !lastUpdatedAt) return [];

    return [{
      pluginId,
      lastUpdatedAt,
      configItems: readResourceSnapshotConfigItems(entry.configItems),
    }];
  });
}

function readResourceSnapshotMarketplaces(value: unknown): Record<string, ResourceSnapshotMarketplace> {
  if (!isRecord(value)) return {};

  const marketplaces: Record<string, ResourceSnapshotMarketplace> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const marketplaceId = key.trim();
    const lastUpdatedAt = typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt.trim() : "";
    if (!marketplaceId || !lastUpdatedAt) continue;
    marketplaces[marketplaceId] = {
      lastUpdatedAt,
      plugins: readResourceSnapshotPlugins(entry.plugins),
    };
  }
  return marketplaces;
}

export function normalizeResourceSnapshot(value: unknown): ResourceSnapshot | null {
  if (!isRecord(value)) return null;
  const organizationId = typeof value.organizationId === "string" ? value.organizationId.trim() : "";
  const orgMemberId = typeof value.orgMemberId === "string" ? value.orgMemberId.trim() : "";
  const resources = isRecord(value.resources) ? value.resources : null;
  if (!organizationId || !orgMemberId || !resources) return null;

  return {
    organizationId,
    orgMemberId,
    teamIds: readStringArray(value.teamIds),
    resources: {
      llmProviders: readTimestampRecord(resources.llmProviders),
      marketplaces: readResourceSnapshotMarketplaces(resources.marketplaces),
    },
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function readImportedProviders(value: unknown): Record<string, CloudImportedProvider> {
  if (!isRecord(value)) return {};

  const providers: Record<string, CloudImportedProvider> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const cloudProviderId = readString(entry.cloudProviderId) ?? key.trim();
    if (!cloudProviderId) continue;
    providers[cloudProviderId] = {
      cloudProviderId,
      updatedAt: readString(entry.updatedAt),
    };
  }
  return providers;
}

export function readWorkspaceCloudImports(ipollowork: Record<string, unknown>): WorkspaceCloudImports {
  const cloudImports = isRecord(ipollowork.cloudImports) ? ipollowork.cloudImports : {};
  return {
    providers: readImportedProviders(cloudImports.providers),
  };
}

function readChange(value: unknown): DesktopCloudSyncChange | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const kind = value.kind === "new" || value.kind === "modified" || value.kind === "removed"
    ? value.kind
    : null;
  const resourceKind = value.resourceKind === "llmProvider" ? value.resourceKind : null;
  const queuedAt = typeof value.queuedAt === "number" && Number.isFinite(value.queuedAt)
    ? value.queuedAt
    : Date.now();
  if (!id || !kind || !resourceKind) return null;

  return {
    id,
    kind,
    resourceKind,
    previousLastUpdatedAt: readString(value.previousLastUpdatedAt),
    nextLastUpdatedAt: readString(value.nextLastUpdatedAt),
    queuedAt,
  };
}

function readDesktopCloudSyncEntry(contextKey: string, value: unknown): DesktopCloudSyncEntry | null {
  if (!isRecord(value)) return null;
  const snapshot = normalizeResourceSnapshot(value.snapshot);
  if (!snapshot) return null;

  return {
    contextKey,
    fetchedAt: typeof value.fetchedAt === "number" && Number.isFinite(value.fetchedAt) ? value.fetchedAt : 0,
    organizationId: readString(value.organizationId) ?? snapshot.organizationId,
    orgMemberId: readString(value.orgMemberId) ?? snapshot.orgMemberId,
    pendingChanges: Array.isArray(value.pendingChanges)
      ? value.pendingChanges.flatMap((entry) => {
          const change = readChange(entry);
          return change ? [change] : [];
        })
      : [],
    snapshot,
    teamIds: readStringArray(value.teamIds),
  };
}

export function readDesktopCloudSyncState(ipollowork: Record<string, unknown>): DesktopCloudSyncState {
  const raw = isRecord(ipollowork.desktopCloudSync) ? ipollowork.desktopCloudSync : {};
  const rawEntries = isRecord(raw.entries) ? raw.entries : {};
  const entries: Record<string, DesktopCloudSyncEntry> = {};
  for (const [key, entry] of Object.entries(rawEntries)) {
    const contextKey = key.trim();
    const parsed = contextKey ? readDesktopCloudSyncEntry(contextKey, entry) : null;
    if (parsed) entries[contextKey] = parsed;
  }

  return {
    entries,
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    version: 1,
  };
}

function contextKey(snapshot: ResourceSnapshot): string {
  return [snapshot.organizationId, snapshot.orgMemberId].join("::");
}

function changeKey(change: Pick<DesktopCloudSyncChange, "id" | "resourceKind">) {
  return [change.resourceKind, change.id].join("::");
}

function mergePendingChanges(previous: DesktopCloudSyncChange[], next: DesktopCloudSyncChange[]) {
  if (next.length === 0) return previous;
  const nextKeys = new Set(next.map(changeKey));
  return [
    ...previous.filter((change) => !nextKeys.has(changeKey(change))),
    ...next,
  ];
}

function queueInstalledChange(input: {
  changes: DesktopCloudSyncChange[];
  id: string;
  installedLastUpdatedAt: string | null;
  queuedAt: number;
  remoteLastUpdatedAt: string | null;
  resourceKind: DesktopCloudSyncResourceKind;
}) {
  if (!input.remoteLastUpdatedAt) {
    input.changes.push({
      id: input.id,
      kind: "removed",
      resourceKind: input.resourceKind,
      previousLastUpdatedAt: input.installedLastUpdatedAt,
      nextLastUpdatedAt: null,
      queuedAt: input.queuedAt,
    });
    return;
  }

  if (!input.installedLastUpdatedAt) {
    input.changes.push({
      id: input.id,
      kind: "new",
      resourceKind: input.resourceKind,
      previousLastUpdatedAt: null,
      nextLastUpdatedAt: input.remoteLastUpdatedAt,
      queuedAt: input.queuedAt,
    });
    return;
  }

  if (input.installedLastUpdatedAt !== input.remoteLastUpdatedAt) {
    input.changes.push({
      id: input.id,
      kind: "modified",
      resourceKind: input.resourceKind,
      previousLastUpdatedAt: input.installedLastUpdatedAt,
      nextLastUpdatedAt: input.remoteLastUpdatedAt,
      queuedAt: input.queuedAt,
    });
  }
}

function diffInstalledCloudResources(
  cloudImports: WorkspaceCloudImports,
  snapshot: ResourceSnapshot,
  queuedAt: number,
): DesktopCloudSyncChange[] {
  const changes: DesktopCloudSyncChange[] = [];

  for (const provider of Object.values(cloudImports.providers)) {
    queueInstalledChange({
      changes,
      id: provider.cloudProviderId,
      installedLastUpdatedAt: provider.updatedAt,
      queuedAt,
      remoteLastUpdatedAt: snapshot.resources.llmProviders[provider.cloudProviderId] ?? null,
      resourceKind: "llmProvider",
    });
  }

  return changes;
}

export function syncDesktopCloudResources(input: {
  now?: number;
  ipollowork: Record<string, unknown>;
  snapshot: ResourceSnapshot;
}) {
  const now = input.now ?? Date.now();
  const state = readDesktopCloudSyncState(input.ipollowork);
  const key = contextKey(input.snapshot);
  const previousEntry = state.entries[key] ?? null;
  const changes = diffInstalledCloudResources(readWorkspaceCloudImports(input.ipollowork), input.snapshot, now);
  const entry: DesktopCloudSyncEntry = {
    contextKey: key,
    fetchedAt: now,
    organizationId: input.snapshot.organizationId,
    orgMemberId: input.snapshot.orgMemberId,
    pendingChanges: mergePendingChanges(previousEntry?.pendingChanges ?? [], changes),
    snapshot: input.snapshot,
    teamIds: input.snapshot.teamIds,
  };
  const nextState: DesktopCloudSyncState = {
    entries: {
      ...state.entries,
      [key]: entry,
    },
    updatedAt: now,
    version: 1,
  };

  return {
    changes,
    ipollowork: {
      ...input.ipollowork,
      desktopCloudSync: nextState,
    },
    state: nextState,
  };
}
