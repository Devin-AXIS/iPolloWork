/** @jsxImportSource react */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  Plus,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_WORK_BOARD_CONFIG,
  type WorkBoardConfig,
  type WorkBoardConfigValue,
} from "@ipollowork/types/work-items";

import type { WorkspaceInfo } from "@/app/lib/desktop";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { isRemoteWorkspace } from "@/app/lib/workspace-endpoint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";

import {
  WorkCalendar,
  type WorkCalendarItem,
  type WorkCalendarView,
} from "./work-calendar";
import { WorkItemSheet, type WorkItemEditorValue } from "./work-item-sheet";
import { BoardConfigDialog } from "./board-config-dialog";
import { ProjectBoard, type ProjectBoardItem } from "./project-board";
import { ProjectPickerDialog } from "./project-picker-dialog";
import { readProjectWorkspaceConfig } from "./project-overview-shared";
import { loadProjectRuntimeMetrics, type ProjectRuntimeExecutionRecord } from "./project-runtime-metrics";
import { WorkCenterError, WorkCenterLoading } from "./work-center-states";
import {
  endpointForWorkspace,
  groupWorkEndpoints,
  listEndpointWorkItems,
  workProjectName,
  type WorkEndpoint,
} from "./work-endpoints";

type WorkCenterMode = "global" | "project";
type ProjectView = "board" | "schedule";

type WorkCenterProps = {
  mode: WorkCenterMode;
  selectedWorkspaceId: string;
  runtimeWorkspaceId: string | null;
  selectedClient: iPolloWorkServerClient | null;
  environmentClient: iPolloWorkServerClient | null;
  workspaces: WorkspaceInfo[];
};

type ResolvedWorkItem = ProjectBoardItem & {
  endpoint: WorkEndpoint;
};

type RuntimeTaskSnapshot = {
  records: ProjectRuntimeExecutionRecord[];
  statusByExecution: Record<ProjectRuntimeExecutionRecord["status"], string>;
  statusGroups: {
    waiting: string[];
    active: string[];
    completed: string[];
    failed: string[];
  };
};

type GlobalRuntimeTaskSnapshot = {
  items: ResolvedWorkItem[];
  statusGroupsByWorkspaceId: Record<string, RuntimeTaskSnapshot["statusGroups"]>;
};

const DEFAULT_STATUS_GROUPS: RuntimeTaskSnapshot["statusGroups"] = {
  waiting: ["planned", "ready"],
  active: ["running", "review"],
  completed: ["done"],
  failed: ["failed"],
};

function localizedBoard(board: WorkBoardConfig): WorkBoardConfig {
  if (board.version !== 0) return board;
  const labelById: Record<string, string> = {
    planned: t("work.status.planned"),
    ready: t("work.status.ready"),
    running: t("work.status.running"),
    review: t("work.status.review"),
    done: t("work.status.done"),
    failed: t("work.status.failed"),
  };
  return {
    ...board,
    columns: board.columns.map((column) => ({ ...column, label: labelById[column.id] ?? column.label })),
  };
}

function defaultBoard(workspaceId: string): WorkBoardConfig {
  return localizedBoard({
    workspaceId,
    columns: DEFAULT_WORK_BOARD_CONFIG.columns,
    fields: DEFAULT_WORK_BOARD_CONFIG.fields,
    version: 0,
    updatedAt: null,
  });
}

function runtimeTaskItems(endpoint: WorkEndpoint, snapshot: RuntimeTaskSnapshot): ResolvedWorkItem[] {
  return snapshot.records.map((record) => {
    const status = snapshot.statusByExecution[record.status];
    return {
      key: `${endpoint.key}:${endpoint.workspaceId}:runtime:${record.sessionId}`,
      endpoint,
      projectName: endpoint.projectName,
      executionRecord: record,
      item: {
        id: `runtime-${record.sessionId}`,
        workspaceId: endpoint.workspaceId,
        title: record.title,
        description: record.rootTaskTitle ? t("work.execution.part_of", { task: record.rootTaskTitle }) : null,
        status,
        assignee: record.agentName,
        priority: "normal",
        startAt: null,
        dueAt: null,
        position: record.updatedAt,
        customFields: {},
        execution: null,
        lastError: null,
        runStartedAt: record.startedAt,
        runCompletedAt: record.status === "completed" || record.status === "failed" ? record.updatedAt : null,
        version: 0,
        createdAt: record.startedAt,
        updatedAt: record.updatedAt,
      },
    };
  });
}

function GlobalWorkSummary(props: {
  items: ResolvedWorkItem[];
  statusGroupsByWorkspaceId: GlobalRuntimeTaskSnapshot["statusGroupsByWorkspaceId"];
  loading: boolean;
}) {
  const counts = { total: props.items.length, active: 0, completed: 0, failed: 0, unscheduled: 0 };
  const projects = new Set<string>();
  for (const entry of props.items) {
    projects.add(entry.item.workspaceId);
    if (entry.item.startAt === null && entry.item.dueAt === null) counts.unscheduled += 1;
    const groups = props.statusGroupsByWorkspaceId[entry.item.workspaceId] ?? DEFAULT_STATUS_GROUPS;
    if (groups.completed.includes(entry.item.status)) counts.completed += 1;
    else if (groups.failed.includes(entry.item.status)) counts.failed += 1;
    else if (groups.active.includes(entry.item.status)) counts.active += 1;
  }
  const metrics = [
    { label: t("work.global.total"), value: counts.total },
    { label: t("work.global.projects"), value: projects.size },
    { label: t("work.global.active"), value: counts.active },
    { label: t("work.global.completed"), value: counts.completed },
    { label: t("work.global.failed"), value: counts.failed },
    { label: t("work.global.unscheduled"), value: counts.unscheduled },
  ];
  return (
    <section className="mb-3 shrink-0 rounded-2xl border border-white/25 bg-dls-surface/75 px-4 py-3 shadow-[0_12px_36px_rgba(30,48,74,0.055),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-xl dark:border-white/[0.065]" data-testid="global-work-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[12px] font-medium text-dls-text">{t("work.global.summary")}</h2>
          <p className="mt-0.5 text-[9px] text-dls-tertiary">{t("work.global.summary_description")}</p>
        </div>
        {props.loading ? <span className="text-[9px] text-dls-tertiary">{t("work.global.syncing")}</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-y-3 sm:grid-cols-6">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 border-dls-border/70 sm:border-l sm:px-4 sm:first:border-l-0 sm:first:pl-0">
            <div className="text-[18px] font-semibold tracking-[-0.45px] tabular-nums text-dls-text">{metric.value}</div>
            <div className="mt-0.5 truncate text-[9px] text-dls-tertiary">{metric.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkCenter(props: WorkCenterProps) {
  const queryClient = useQueryClient();
  const [projectView, setProjectView] = React.useState<ProjectView>("board");
  const [calendarView, setCalendarView] = React.useState<WorkCalendarView>("week");
  const [anchorDate, setAnchorDate] = React.useState(() => new Date());
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingEntry, setEditingEntry] = React.useState<ResolvedWorkItem | null>(null);
  const [createEndpoint, setCreateEndpoint] = React.useState<WorkEndpoint | null>(null);
  const [createStatus, setCreateStatus] = React.useState("planned");
  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false);
  const [boardSettingsOpen, setBoardSettingsOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<ResolvedWorkItem | null>(null);

  const namedWorkspaces = React.useMemo(() => props.workspaces.filter((workspace) => !workspace.isDefault), [props.workspaces]);
  const selectedWorkspace = props.workspaces.find((workspace) => workspace.id === props.selectedWorkspaceId) ?? null;
  const selectedEndpoint = React.useMemo<WorkEndpoint | null>(() => {
    if (!selectedWorkspace) return null;
    if (props.selectedClient && props.runtimeWorkspaceId) {
      return {
        key: isRemoteWorkspace(selectedWorkspace) ? `remote:${selectedWorkspace.id}` : `local:${props.selectedClient.baseUrl}`,
        client: props.selectedClient,
        workspaceId: props.runtimeWorkspaceId,
        workspace: selectedWorkspace,
        projectName: workProjectName(selectedWorkspace),
      };
    }
    return endpointForWorkspace(selectedWorkspace, props.environmentClient);
  }, [props.environmentClient, props.runtimeWorkspaceId, props.selectedClient, selectedWorkspace]);
  const allEndpoints = React.useMemo(() => namedWorkspaces.flatMap((workspace) => {
    const endpoint = endpointForWorkspace(workspace, props.environmentClient);
    return endpoint ? [endpoint] : [];
  }), [namedWorkspaces, props.environmentClient]);
  const endpointGroups = React.useMemo(() => groupWorkEndpoints(allEndpoints), [allEndpoints]);

  const itemsQuery = useQuery({
    queryKey: [
      "work-items",
      props.mode,
      props.mode === "project" ? selectedEndpoint?.key : endpointGroups.map((group) => `${group.key}:${group.endpoints.map((endpoint) => endpoint.workspaceId).join(",")}`).join("|"),
    ],
    enabled: props.mode === "project" ? Boolean(selectedEndpoint) : endpointGroups.length > 0,
    queryFn: async (): Promise<ResolvedWorkItem[]> => {
      const groups = props.mode === "project" && selectedEndpoint
        ? [{ key: selectedEndpoint.key, client: selectedEndpoint.client, endpoints: [selectedEndpoint] }]
        : endpointGroups;
      const responses = await Promise.all(groups.map(async (group) => {
        const groupItems = await listEndpointWorkItems(group.client, {
          workspaceIds: group.endpoints.map((endpoint) => endpoint.workspaceId),
        });
        const endpointByWorkspaceId = new Map(group.endpoints.map((endpoint) => [endpoint.workspaceId, endpoint]));
        return groupItems.flatMap((item) => {
          const endpoint = endpointByWorkspaceId.get(item.workspaceId);
          return endpoint ? [{
            key: `${endpoint.key}:${endpoint.workspaceId}:${item.id}`,
            item,
            endpoint,
            projectName: endpoint.projectName,
          }] : [];
        });
      }));
      return responses.flat();
    },
  });

  const projectBoardQuery = useQuery({
    queryKey: ["work-board", selectedEndpoint?.key, selectedEndpoint?.workspaceId],
    enabled: props.mode === "project" && Boolean(selectedEndpoint),
    queryFn: () => {
      if (!selectedEndpoint) throw new Error("Project endpoint is unavailable");
      return selectedEndpoint.client.getWorkBoard(selectedEndpoint.workspaceId);
    },
  });

  const projectRuntimeQuery = useQuery({
    queryKey: [
      "project-task-runtime",
      selectedEndpoint?.key,
      selectedEndpoint?.workspaceId,
      itemsQuery.data?.map((entry) => `${entry.item.id}:${entry.item.version}`).join("|") ?? "loading",
    ],
    enabled: props.mode === "project" && Boolean(selectedEndpoint && itemsQuery.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<RuntimeTaskSnapshot> => {
      if (!selectedEndpoint) throw new Error(t("work.project_unavailable"));
      const workItems = (itemsQuery.data ?? []).map((entry) => entry.item);
      const response = await selectedEndpoint.client.getConfig(selectedEndpoint.workspaceId);
      const config = readProjectWorkspaceConfig(response.ipollowork, selectedEndpoint.workspace.engineId);
      const metrics = await loadProjectRuntimeMetrics({
        client: selectedEndpoint.client,
        workspaceId: selectedEndpoint.workspaceId,
        agents: config.agents,
        items: workItems,
      });
      const groups = config.dashboard.taskHealth.statusGroups;
      return {
        records: metrics.executionRecords,
        statusGroups: groups,
        statusByExecution: {
          running: groups.active[0] ?? "running",
          completed: groups.completed[0] ?? "done",
          failed: groups.failed[0] ?? "failed",
          unknown: groups.active[0] ?? "review",
        },
      };
    },
  });

  const globalRuntimeQuery = useQuery({
    queryKey: [
      "global-project-task-runtime",
      endpointGroups.map((group) => `${group.key}:${group.endpoints.map((endpoint) => endpoint.workspaceId).join(",")}`).join("|"),
      itemsQuery.data?.map((entry) => `${entry.item.id}:${entry.item.version}`).join("|") ?? "loading",
    ],
    enabled: props.mode === "global" && Boolean(itemsQuery.data && allEndpoints.length),
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<GlobalRuntimeTaskSnapshot> => {
      const workItemsByWorkspaceId = new Map<string, ResolvedWorkItem[]>();
      for (const entry of itemsQuery.data ?? []) {
        const workspaceItems = workItemsByWorkspaceId.get(entry.item.workspaceId) ?? [];
        workspaceItems.push(entry);
        workItemsByWorkspaceId.set(entry.item.workspaceId, workspaceItems);
      }

      const snapshots = await Promise.all(allEndpoints.map(async (endpoint) => {
        const workspaceEntries = workItemsByWorkspaceId.get(endpoint.workspaceId) ?? [];
        let statusGroups = DEFAULT_STATUS_GROUPS;
        let config: ReturnType<typeof readProjectWorkspaceConfig>;
        try {
          const response = await endpoint.client.getConfig(endpoint.workspaceId);
          config = readProjectWorkspaceConfig(response.ipollowork, endpoint.workspace.engineId);
          statusGroups = config.dashboard.taskHealth.statusGroups;
        } catch {
          return { endpoint, statusGroups, records: [] as ProjectRuntimeExecutionRecord[] };
        }
        if (!workspaceEntries.some((entry) => entry.item.execution)) {
          return { endpoint, statusGroups, records: [] as ProjectRuntimeExecutionRecord[] };
        }
        try {
          const metrics = await loadProjectRuntimeMetrics({
            client: endpoint.client,
            workspaceId: endpoint.workspaceId,
            agents: config.agents,
            items: workspaceEntries.map((entry) => entry.item),
          });
          return { endpoint, statusGroups, records: metrics.executionRecords };
        } catch {
          return { endpoint, statusGroups, records: [] as ProjectRuntimeExecutionRecord[] };
        }
      }));

      const statusGroupsByWorkspaceId: GlobalRuntimeTaskSnapshot["statusGroupsByWorkspaceId"] = {};
      const runtimeItems: ResolvedWorkItem[] = [];
      for (const snapshot of snapshots) {
        statusGroupsByWorkspaceId[snapshot.endpoint.workspaceId] = snapshot.statusGroups;
        const groups = snapshot.statusGroups;
        runtimeItems.push(...runtimeTaskItems(snapshot.endpoint, {
          records: snapshot.records,
          statusGroups: groups,
          statusByExecution: {
            running: groups.active[0] ?? "running",
            completed: groups.completed[0] ?? "done",
            failed: groups.failed[0] ?? "failed",
            unknown: groups.active[0] ?? "review",
          },
        }));
      }
      return { items: runtimeItems, statusGroupsByWorkspaceId };
    },
  });

  const editorEndpoint = editingEntry?.endpoint ?? createEndpoint ?? selectedEndpoint;
  const editorBoardQuery = useQuery({
    queryKey: ["work-board", editorEndpoint?.key, editorEndpoint?.workspaceId],
    enabled: editorOpen && Boolean(editorEndpoint),
    queryFn: () => {
      if (!editorEndpoint) throw new Error("Project endpoint is unavailable");
      return editorEndpoint.client.getWorkBoard(editorEndpoint.workspaceId);
    },
  });

  const board = localizedBoard(projectBoardQuery.data ?? defaultBoard(selectedEndpoint?.workspaceId ?? ""));
  const editorBoard = localizedBoard(editorBoardQuery.data ?? (editorEndpoint?.workspaceId === selectedEndpoint?.workspaceId ? board : defaultBoard(editorEndpoint?.workspaceId ?? "")));

  const invalidateWork = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["work-items"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async (value: WorkItemEditorValue) => {
      if (!editorEndpoint) throw new Error(t("work.project_unavailable"));
      return editorEndpoint.client.createWorkItem(editorEndpoint.workspaceId, value);
    },
    onSuccess: async () => {
      setPendingDelete(null);
      setEditorOpen(false);
      setEditingEntry(null);
      setCreateEndpoint(null);
      await invalidateWork();
    },
    onError: (error) => toast.error(t("work.save_failed"), { description: error instanceof Error ? error.message : undefined }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ entry, value }: { entry: ResolvedWorkItem; value: Partial<WorkItemEditorValue> & { position?: number } }) => entry.endpoint.client.updateWorkItem(
      entry.endpoint.workspaceId,
      entry.item.id,
      { ...value, expectedVersion: entry.item.version },
    ),
    onSuccess: async () => {
      setEditorOpen(false);
      setEditingEntry(null);
      await invalidateWork();
    },
    onError: (error) => toast.error(t("work.save_failed"), { description: error instanceof Error ? error.message : undefined }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (entry: ResolvedWorkItem) => entry.endpoint.client.deleteWorkItem(entry.endpoint.workspaceId, entry.item.id, entry.item.version),
    onSuccess: async () => {
      setEditorOpen(false);
      setEditingEntry(null);
      await invalidateWork();
    },
    onError: (error) => toast.error(t("work.delete_failed"), { description: error instanceof Error ? error.message : undefined }),
  });

  const boardMutation = useMutation({
    mutationFn: async (value: WorkBoardConfigValue) => {
      if (!selectedEndpoint) throw new Error(t("work.project_unavailable"));
      return selectedEndpoint.client.updateWorkBoard(selectedEndpoint.workspaceId, value, board.version);
    },
    onSuccess: async () => {
      setBoardSettingsOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["work-board"] });
    },
    onError: (error) => toast.error(t("work.save_failed"), { description: error instanceof Error ? error.message : undefined }),
  });

  const openCreate = (endpoint: WorkEndpoint, status = "planned") => {
    setEditingEntry(null);
    setCreateEndpoint(endpoint);
    setCreateStatus(status);
    setEditorOpen(true);
  };

  const requestCreate = () => {
    if (props.mode === "project") {
      if (selectedEndpoint) openCreate(selectedEndpoint, board.columns[0]?.id ?? "planned");
      return;
    }
    if (allEndpoints.length === 1) {
      openCreate(allEndpoints[0]);
      return;
    }
    setProjectPickerOpen(true);
  };

  const items = itemsQuery.data ?? [];
  const runtimeItems = React.useMemo<ResolvedWorkItem[]>(() => {
    if (props.mode === "global") return globalRuntimeQuery.data?.items ?? [];
    if (!selectedEndpoint || !projectRuntimeQuery.data) return [];
    return runtimeTaskItems(selectedEndpoint, projectRuntimeQuery.data);
  }, [globalRuntimeQuery.data?.items, projectRuntimeQuery.data, props.mode, selectedEndpoint]);
  const boardItems = [...items, ...runtimeItems];
  const calendarItems = props.mode === "global"
    ? boardItems
    : items.filter((entry) => entry.item.startAt !== null || entry.item.dueAt !== null);
  const title = props.mode === "global" ? t("work.global_title") : t("work.project_title");
  const subtitle = props.mode === "global"
    ? t("work.global_description")
    : t("work.project_description", { project: selectedEndpoint?.projectName ?? t("work.project_title") });
  const showBoard = props.mode === "project" && projectView === "board";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_18%_0%,rgba(74,158,178,0.11),transparent_34%),radial-gradient(circle_at_86%_8%,rgba(99,116,165,0.08),transparent_30%),var(--dls-surface)] text-dls-text">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-white/20 bg-dls-surface/72 px-4 py-3 backdrop-blur-2xl dark:border-white/[0.06] sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {props.mode === "global" ? <CalendarRange className="size-4 text-dls-secondary" /> : <LayoutDashboard className="size-4 text-dls-secondary" />}
            <h1 className="truncate text-[16px] font-semibold tracking-[-0.35px]">{title}</h1>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-dls-secondary">{subtitle}</p>
        </div>

        {props.mode === "project" ? (
          <div className="inline-flex rounded-lg bg-dls-hover/70 p-1">
            <button type="button" className={cn("flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition", projectView === "board" ? "bg-dls-surface text-dls-text shadow-sm" : "text-dls-secondary hover:text-dls-text")} onClick={() => setProjectView("board")}>
              <LayoutDashboard className="size-3.5" />{t("work.board")}
            </button>
            <button type="button" className={cn("flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition", projectView === "schedule" ? "bg-dls-surface text-dls-text shadow-sm" : "text-dls-secondary hover:text-dls-text")} onClick={() => setProjectView("schedule")}>
              <CalendarDays className="size-3.5" />{t("work.schedule")}
            </button>
          </div>
        ) : null}

        {props.mode === "project" ? (
          <Button type="button" variant="ghost" size="sm" className="rounded-lg" onClick={() => setBoardSettingsOpen(true)} disabled={!selectedEndpoint}>
            <Settings2 className="size-4" />{t("work.fields")}
          </Button>
        ) : null}
        <Button type="button" size="sm" className="rounded-lg" onClick={requestCreate} disabled={props.mode === "project" ? !selectedEndpoint : !allEndpoints.length}>
          <Plus className="size-4" />{props.mode === "global" ? t("work.new_schedule") : t("work.new_item")}
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        {itemsQuery.isLoading || (props.mode === "project" && projectBoardQuery.isLoading) ? <WorkCenterLoading /> : itemsQuery.isError ? (
          <WorkCenterError onRetry={() => void itemsQuery.refetch()} />
        ) : showBoard ? (
          <ProjectBoard
            items={boardItems}
            board={board}
            moving={updateMutation.isPending}
            onMove={(entryKey, status, position) => {
              const entry = items.find((candidate) => candidate.key === entryKey);
              if (entry) updateMutation.mutate({ entry, value: { status, position } });
            }}
            onOpen={(entryKey) => {
              const entry = items.find((candidate) => candidate.key === entryKey);
              if (!entry) return;
              setEditingEntry(entry);
              setCreateEndpoint(null);
              setEditorOpen(true);
            }}
            onCreate={(status) => {
              if (selectedEndpoint) openCreate(selectedEndpoint, status);
            }}
          />
        ) : (
          <>
            {props.mode === "global" ? (
              <GlobalWorkSummary
                items={boardItems}
                statusGroupsByWorkspaceId={globalRuntimeQuery.data?.statusGroupsByWorkspaceId ?? {}}
                loading={globalRuntimeQuery.isLoading || globalRuntimeQuery.isFetching}
              />
            ) : null}
            <WorkCalendar
              items={calendarItems}
              anchorDate={anchorDate}
              view={calendarView}
              onAnchorDateChange={setAnchorDate}
              onViewChange={setCalendarView}
              onSelectItem={(entry) => {
                const resolved = items.find((candidate) => candidate.key === entry.key);
                if (!resolved) return;
                setEditingEntry(resolved);
                setCreateEndpoint(null);
                setEditorOpen(true);
              }}
            />
          </>
        )}
      </main>

      <WorkItemSheet
        open={editorOpen}
        item={editingEntry?.item ?? null}
        board={editorBoard}
        defaultStatus={createStatus || editorBoard.columns[0]?.id || "planned"}
        saving={createMutation.isPending || updateMutation.isPending}
        deleting={deleteMutation.isPending}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditingEntry(null);
            setCreateEndpoint(null);
          }
        }}
        onSave={(value) => {
          if (editingEntry) updateMutation.mutate({ entry: editingEntry, value });
          else createMutation.mutate(value);
        }}
        onDelete={editingEntry ? () => setPendingDelete(editingEntry) : undefined}
      />

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("work.delete_title")}
        message={t("work.delete_description", { title: pendingDelete?.item.title ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <BoardConfigDialog
        open={boardSettingsOpen}
        board={board}
        saving={boardMutation.isPending}
        onOpenChange={setBoardSettingsOpen}
        onSave={(value) => boardMutation.mutate(value)}
      />

      <ProjectPickerDialog
        open={projectPickerOpen}
        endpoints={allEndpoints}
        onOpenChange={setProjectPickerOpen}
        onSelect={(endpoint) => {
          setProjectPickerOpen(false);
          openCreate(endpoint);
        }}
      />
    </div>
  );
}
