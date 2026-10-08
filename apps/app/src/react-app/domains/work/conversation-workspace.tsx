/** @jsxImportSource react */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDefaultProjectWorkspaceConfig } from "@ipollowork/types/project-workspace";
import type {
  ProjectSessionExecutionRuntime,
  WorkItem,
  WorkTemplate,
} from "@ipollowork/types/work-items";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { t, translationKey } from "@/i18n";
import { cn } from "@/lib/utils";

import { loadProjectRuntimeMetrics } from "./project-runtime-metrics";
import { engineLabel } from "./project-overview-shared";
import { ProjectDashboard } from "./project-dashboard";
import { listEndpointWorkItems } from "./work-endpoints";
import { WorkCenterError } from "./work-center-states";

function templateLabel(template: WorkTemplate): string {
  return template.origin === "builtin" ? t(translationKey("conversation_work.kind.", template.workKind)) : template.name;
}

export function WorkTemplatePicker(props: {
  templates: WorkTemplate[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  allowAuto?: boolean;
}) {
  const templates = props.templates;
  const selectedTemplate = templates.find((template) => template.id === props.value);
  const label =
    props.value === "auto"
      ? t("conversation_work.auto")
      : selectedTemplate
        ? templateLabel(selectedTemplate)
        : t("conversation_work.kind.general");
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value) props.onValueChange(value);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "max-w-full rounded-lg border-transparent bg-dls-hover/60 text-xs shadow-none hover:bg-dls-hover",
          props.className,
        )}
        aria-label={t("conversation_work.method")}
        data-testid="work-template-picker"
      >
        <Sparkles className="size-3.5 text-dls-secondary" />
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-52">
        {props.allowAuto !== false ? <SelectItem value="auto">{t("conversation_work.auto")}</SelectItem> : null}
        {!templates.some((template) => template.id === "general") ? (
          <SelectItem value="general">{t("conversation_work.kind.general")}</SelectItem>
        ) : null}
        {templates.map((template) => (
          <SelectItem key={template.id} value={template.id}>
            {templateLabel(template)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type ConversationWorkspaceProps = {
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  sessionId: string | null;
  engineId: string;
  runtime: ProjectSessionExecutionRuntime;
  onOpenTasks: () => void;
  title?: string;
};

export function ConversationWorkspace(props: ConversationWorkspaceProps) {
  const queryClient = useQueryClient();
  const workflowQueryKey = ["conversation-workflow", props.client?.baseUrl, props.workspaceId, props.sessionId];
  const workflowQuery = useQuery({
    queryKey: workflowQueryKey,
    enabled: Boolean(props.client && props.workspaceId && props.sessionId),
    queryFn: async () => {
      if (!props.client || !props.workspaceId || !props.sessionId) throw new Error(t("work.project_unavailable"));
      return props.client.getConversationWorkflow(props.workspaceId, props.sessionId);
    },
    refetchInterval: (query) => (query.state.data?.item?.status === "running" ? 2_000 : 15_000),
  });
  const workflowItem = workflowQuery.data?.item;
  const tasksQuery = useQuery({
    queryKey: ["work-items", props.client?.baseUrl, props.workspaceId, props.sessionId],
    enabled: Boolean(props.client && props.workspaceId && props.sessionId),
    queryFn: async () => {
      if (!props.client || !props.workspaceId || !props.sessionId) throw new Error(t("work.project_unavailable"));
      return listEndpointWorkItems(props.client, { workspaceIds: [props.workspaceId], sessionId: props.sessionId });
    },
    refetchInterval: workflowItem?.status === "running" ? 5_000 : 30_000,
  });
  const itemsById = new Map<string, WorkItem>();
  for (const entry of [...(tasksQuery.data ?? []), ...(workflowItem ? [workflowItem] : [])]) {
    const current = itemsById.get(entry.id);
    if (!current || entry.version > current.version) itemsById.set(entry.id, entry);
  }
  const scopedItems = [...itemsById.values()];
  const item = workflowItem ? itemsById.get(workflowItem.id)
    : scopedItems.find((entry) => entry.execution?.sessionId === props.sessionId && entry.execution.workflow);
  const workflow = item?.execution?.workflow;
  const baseConfig = workflow?.config ?? createDefaultProjectWorkspaceConfig({ engineId: props.engineId });
  const config = { ...baseConfig, goal: workflow?.goal ?? baseConfig.goal };
  const boardQuery = useQuery({
    queryKey: ["work-board", props.client?.baseUrl, props.workspaceId],
    enabled: Boolean(props.client && props.workspaceId),
    queryFn: async () => {
      if (!props.client || !props.workspaceId) throw new Error(t("work.project_unavailable"));
      return props.client.getWorkBoard(props.workspaceId);
    },
    staleTime: 30_000,
  });
  const runtimeAgents = config.agents;
  const actualDelegationQuery = useQuery({
    queryKey: [
      "conversation-delegation",
      props.client?.baseUrl,
      props.workspaceId,
      props.sessionId,
      item?.version,
      runtimeAgents.map((agent) => agent.id).join("|"),
      scopedItems.map((entry) => `${entry.id}:${entry.version}`).join("|"),
    ],
    enabled: Boolean(props.client && props.workspaceId && item?.execution),
    queryFn: async () => {
      if (!props.client || !props.workspaceId || !item?.execution) throw new Error(t("work.project_unavailable"));
      return loadProjectRuntimeMetrics({
        client: props.client,
        workspaceId: props.workspaceId,
        agents: runtimeAgents,
        items: scopedItems,
      });
    },
    refetchInterval: item?.status === "running" ? 5_000 : 30_000,
    staleTime: 10_000,
  });
  const invalidateWork = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workflowQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["work-items"] }),
    ]);
  };
  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!props.client || !props.workspaceId || !item || item.status !== "review")
        throw new Error(t("work.project_unavailable"));
      return props.client.updateWorkItem(props.workspaceId, item.id, {
        expectedVersion: item.version,
        status: "done",
      });
    },
    onSuccess: invalidateWork,
    onError: (error) =>
      toast.error(t("work.save_failed"), {
        description: error instanceof Error ? error.message : undefined,
      }),
  });

  if (!props.client || !props.workspaceId) return <WorkCenterError onRetry={() => undefined} />;
  if (workflowQuery.isLoading || boardQuery.isLoading) {
    return <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8" aria-busy="true">
      <Skeleton className="h-7 w-44" /><Skeleton className="h-16 w-full" /><Skeleton className="h-32 w-full" />
    </div>;
  }
  if (workflowQuery.isError || boardQuery.isError || !boardQuery.data) {
    return <WorkCenterError onRetry={() => {
      void workflowQuery.refetch();
      void boardQuery.refetch();
    }} />;
  }

  return (
    <div className="h-full min-h-0" data-testid="conversation-workspace">
      <ProjectDashboard
        projectName={props.title || t("conversation_work.title")}
        config={config}
        items={scopedItems}
        board={boardQuery.data}
        plugins={[]}
        authorizations={{}}
        mainSessionId={props.sessionId ?? undefined}
        mainEngineName={engineLabel(item?.execution?.runtime.engineId ?? props.engineId)}
        runtimeMetrics={actualDelegationQuery.data ?? null}
        runtimeMetricsLoading={actualDelegationQuery.isLoading}
        runtimeMetricsError={actualDelegationQuery.isError}
        executionHref={(record) => `#/workspace/${props.workspaceId}/session/${record.sessionId}`}
        onOpenTasks={props.onOpenTasks}
        healthContent={<>
          {item?.status === "review" ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dls-border/60 pt-3" data-testid="conversation-review">
            <p className="min-w-0 flex-1 text-xs leading-5 text-dls-secondary">{t("conversation_work.review_hint")}</p>
            <Button size="sm" disabled={acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>
              {acceptMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3.5" />}{t("conversation_work.accept")}
            </Button>
          </div> : item?.status === "done" ? <p className="mt-4 inline-flex items-center gap-2 text-xs text-dls-secondary">
            <Check className="size-3.5" />{t("conversation_work.done_hint")}</p> : null}

        </>}
      />
    </div>
  );
}
