/** @jsxImportSource react */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  projectAgentSchema,
  projectWorkspaceConfigSchema,
  type ProjectAgent,
  type ProjectWorkspaceConfig,
} from "@ipollowork/types/project-workspace";
import type { WorkBoardConfig, WorkItem } from "@ipollowork/types/work-items";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import { toast } from "sonner";

import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import type { ModelRef, ProviderListItem } from "@/app/types";
import { PluginAuthorizationDialog } from "@/components/plugin-authorization-dialog";
import { t } from "@/i18n";

import { ProjectAgentInspector } from "./project-agent-inspector";
import { ProjectDashboard } from "./project-dashboard";
import { loadProjectRuntimeMetrics } from "./project-runtime-metrics";
import { WorkCenterError, WorkCenterLoading } from "./work-center-states";
import { listEndpointWorkItems } from "./work-endpoints";
import { readProjectWorkspaceConfig } from "./project-overview-shared";

type ProjectOverviewProps = {
  projectName: string;
  workspaceId: string | null;
  client: iPolloWorkServerClient | null;
  engineId: string | null | undefined;
  providers: ProviderListItem[];
  projectModel: ModelRef;
  onOpenTasks: () => void;
  onConfigureModels?: (providerId?: string) => void;
  onConfigureTokenStar?: () => void;
};

type ProjectOverviewData = {
  config: ProjectWorkspaceConfig;
  items: WorkItem[];
  board: WorkBoardConfig;
};

type PluginSnapshot = {
  items: iPolloWorkPluginPackageItem[];
  authorizations: Record<string, iPolloWorkPluginAuthorizationState>;
};

function newAgent(): ProjectAgent {
  const id = `agent-${window.crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: t("project_overview.new_agent_name"),
    avatarSeed: id,
    role: "",
    prompt: "",
    skillIds: [],
    pluginIds: [],
    runtime: {
      engineId: null,
      model: null,
      mode: "auto",
      modelVariant: null,
    },
  };
}

export function ProjectOverview(props: ProjectOverviewProps) {
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [draftAgent, setDraftAgent] = React.useState<ProjectAgent | null>(null);
  const [authorizationPluginId, setAuthorizationPluginId] = React.useState<string | null>(null);

  const dataQueryKey = ["project-overview", props.client?.baseUrl, props.workspaceId] as const;
  const dataQuery = useQuery({
    queryKey: dataQueryKey,
    enabled: Boolean(props.client && props.workspaceId),
    queryFn: async (): Promise<ProjectOverviewData> => {
      if (!props.client || !props.workspaceId) throw new Error(t("work.project_unavailable"));
      const [config, items, board] = await Promise.all([
        props.client.getConfig(props.workspaceId),
        listEndpointWorkItems(props.client, { workspaceIds: [props.workspaceId] }),
        props.client.getWorkBoard(props.workspaceId),
      ]);
      return {
        config: readProjectWorkspaceConfig(config.ipollowork, props.engineId),
        items,
        board,
      };
    },
  });

  const pluginQueryKey = ["project-overview-plugins", props.client?.baseUrl, props.workspaceId];
  const pluginQuery = useQuery({
    queryKey: pluginQueryKey,
    enabled: Boolean(props.client && props.workspaceId),
    queryFn: async (): Promise<PluginSnapshot> => {
      const client = props.client;
      const workspaceId = props.workspaceId;
      if (!client || !workspaceId) return { items: [], authorizations: {} };
      const response = await client.listPluginPackages(workspaceId);
      const items = response.items.filter((item) => item.enabled);
      const states = await Promise.allSettled(items.map(async (item) => ({
        pluginId: item.pluginId,
        state: await client.getPluginAuthorization(workspaceId, item.pluginId),
      })));
      return {
        items,
        authorizations: Object.fromEntries(states.flatMap((result) => result.status === "fulfilled" ? [[result.value.pluginId, result.value.state]] : [])),
      };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (config: ProjectWorkspaceConfig) => {
      if (!props.client || !props.workspaceId) throw new Error(t("work.project_unavailable"));
      const current = projectWorkspaceConfigSchema.parse(config);
      const projectEngineId = props.engineId?.trim() || DEFAULT_ENGINE_ID;
      if (current.agents.some((agent) => agent.runtime.engineId !== null && agent.runtime.engineId !== projectEngineId)) {
        throw new Error(t("project_overview.engine_mismatch"));
      }
      const parsed = projectWorkspaceConfigSchema.parse({ ...current, revision: current.revision + 1 });
      await props.client.patchConfig(props.workspaceId, { ipollowork: { project: parsed } });
      return parsed;
    },
    onSuccess: (config) => {
      queryClient.setQueryData<ProjectOverviewData>(dataQueryKey, (current) => current ? { ...current, config } : current);
      setInspectorOpen(false);
      setDraftAgent(null);
      toast.success(t("project_overview.saved"));
    },
    onError: (error) => toast.error(t("project_overview.save_failed"), { description: error instanceof Error ? error.message : undefined }),
  });

  const data = dataQuery.data;
  const plugins = pluginQuery.data?.items ?? [];
  const authorizations = pluginQuery.data?.authorizations ?? {};
  const runtimeMetricsQuery = useQuery({
    queryKey: [
      "project-runtime-metrics",
      props.client?.baseUrl,
      props.workspaceId,
      props.engineId,
      data?.config.agents.map((agent) => `${agent.id}:${agent.name}`).join("|"),
    ],
    enabled: Boolean(props.client && props.workspaceId && data?.config.dashboard.sections.includes("usage")),
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!props.client || !props.workspaceId || !data) throw new Error(t("work.project_unavailable"));
      return loadProjectRuntimeMetrics({
        client: props.client,
        workspaceId: props.workspaceId,
        agents: data.config.agents,
        items: data.items,
      });
    },
  });

  React.useEffect(() => {
    const agents = data?.config.agents ?? [];
    if (!agents.length) return;
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(data?.config.orchestration.entryAgentId ?? agents[0]?.id ?? null);
    }
  }, [data?.config.agents, data?.config.orchestration.entryAgentId, selectedAgentId]);

  if (!props.client || !props.workspaceId) return <WorkCenterError onRetry={() => undefined} />;
  if (dataQuery.isLoading) return <WorkCenterLoading />;
  if (dataQuery.isError || !data) return <WorkCenterError onRetry={() => void dataQuery.refetch()} />;

  const selectedAgent = data.config.agents.find((agent) => agent.id === selectedAgentId) ?? data.config.agents[0];
  const openAgent = (agent: ProjectAgent) => {
    setSelectedAgentId(agent.id);
    setDraftAgent(agent);
    setInspectorOpen(true);
  };
  const saveAgent = (agent: ProjectAgent, primary: boolean) => {
    const parsed = projectAgentSchema.safeParse(agent);
    if (!parsed.success) {
      toast.error(t("project_overview.save_failed"), { description: parsed.error.issues[0]?.message });
      return;
    }
    const exists = data.config.agents.some((candidate) => candidate.id === parsed.data.id);
    const agents = exists
      ? data.config.agents.map((candidate) => candidate.id === parsed.data.id ? parsed.data : candidate)
      : [...data.config.agents, parsed.data];
    saveMutation.mutate({
      ...data.config,
      agents,
      orchestration: {
        ...data.config.orchestration,
        entryAgentId: primary ? parsed.data.id : data.config.orchestration.entryAgentId,
      },
    });
    setSelectedAgentId(parsed.data.id);
  };
  const deleteAgent = () => {
    if (!draftAgent || data.config.agents.length <= 1) return;
    const agents = data.config.agents.filter((agent) => agent.id !== draftAgent.id);
    const entryAgentId = data.config.orchestration.entryAgentId === draftAgent.id
      ? agents[0]?.id
      : data.config.orchestration.entryAgentId;
    if (!entryAgentId) return;
    saveMutation.mutate({
      ...data.config,
      agents,
      orchestration: {
        entryAgentId,
        relations: data.config.orchestration.relations.filter((relation) => (
          relation.sourceAgentId !== draftAgent.id && relation.targetAgentId !== draftAgent.id
        )),
      },
    });
    setSelectedAgentId(entryAgentId);
  };

  return (
    <>
      <ProjectDashboard
        projectName={props.projectName}
        config={data.config}
        items={data.items}
        board={data.board}
        plugins={plugins}
        authorizations={authorizations}
        selectedAgent={selectedAgent}
        runtimeMetrics={runtimeMetricsQuery.data ?? null}
        runtimeMetricsLoading={runtimeMetricsQuery.isLoading}
        runtimeMetricsError={runtimeMetricsQuery.isError}
        onOpenAgent={openAgent}
        onAddAgent={() => {
          setDraftAgent(newAgent());
          setInspectorOpen(true);
        }}
        onOpenTasks={props.onOpenTasks}
      />
      <ProjectAgentInspector
        open={inspectorOpen}
        agent={draftAgent}
        isNew={Boolean(draftAgent && !data.config.agents.some((agent) => agent.id === draftAgent.id))}
        isPrimary={draftAgent?.id === data.config.orchestration.entryAgentId}
        canDelete={data.config.agents.length > 1 && Boolean(draftAgent && data.config.agents.some((agent) => agent.id === draftAgent.id))}
        plugins={plugins}
        authorizations={authorizations}
        providers={props.providers}
        projectModel={props.projectModel}
        projectEngineId={props.engineId}
        saving={saveMutation.isPending}
        onOpenChange={(open) => {
          setInspectorOpen(open);
          if (!open) setDraftAgent(null);
        }}
        onSave={saveAgent}
        onDelete={deleteAgent}
        onAuthorizePlugin={setAuthorizationPluginId}
        onConfigureModels={props.onConfigureModels}
        onConfigureTokenStar={props.onConfigureTokenStar}
      />
      <PluginAuthorizationDialog
        open={authorizationPluginId !== null}
        item={plugins.find((item) => item.pluginId === authorizationPluginId) ?? null}
        authorization={authorizationPluginId ? authorizations[authorizationPluginId] : undefined}
        client={props.client}
        workspaceId={props.workspaceId}
        onOpenChange={(open) => {
          if (!open) setAuthorizationPluginId(null);
        }}
        onUpdated={() => queryClient.invalidateQueries({ queryKey: pluginQueryKey })}
      />
    </>
  );
}
