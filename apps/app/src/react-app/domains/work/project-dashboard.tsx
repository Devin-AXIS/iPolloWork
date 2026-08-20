/** @jsxImportSource react */
import type {
  ProjectAgent,
  ProjectTaskHealthMetric,
  ProjectWorkspaceConfig,
} from "@ipollowork/types/project-workspace";
import type { WorkBoardConfig, WorkItem } from "@ipollowork/types/work-items";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  KeyRound,
  ListTodo,
  Package,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";

import type {
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
} from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  AgentAvatar,
  pluginNeedsConfiguration,
} from "./project-overview-shared";
import { ProjectOrchestrationGraph } from "./project-orchestration-graph";
import { ProjectRuntimeData } from "./project-runtime-data";
import type { ProjectRuntimeMetrics } from "./project-runtime-metrics";

type ProjectDashboardProps = {
  projectName: string;
  config: ProjectWorkspaceConfig;
  items: WorkItem[];
  board: WorkBoardConfig;
  plugins: iPolloWorkPluginPackageItem[];
  authorizations: Record<string, iPolloWorkPluginAuthorizationState>;
  selectedAgent: ProjectAgent | undefined;
  runtimeMetrics: ProjectRuntimeMetrics | null;
  runtimeMetricsLoading: boolean;
  runtimeMetricsError: boolean;
  onOpenAgent: (agent: ProjectAgent) => void;
  onAddAgent: () => void;
  onOpenTasks: () => void;
};

function formatDate(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function taskMetrics(
  items: WorkItem[],
  config: ProjectWorkspaceConfig,
  runtimeRecords: ProjectRuntimeMetrics["executionRecords"] = [],
) {
  const statusGroups = config.dashboard.taskHealth.statusGroups;
  const waitingStatuses = new Set(statusGroups.waiting);
  const activeStatuses = new Set(statusGroups.active);
  const completedStatuses = new Set(statusGroups.completed);
  const failedStatuses = new Set(statusGroups.failed);
  const completed = items.filter((item) => completedStatuses.has(item.status)).length
    + runtimeRecords.filter((record) => record.status === "completed").length;
  const active = items.filter((item) => activeStatuses.has(item.status)).length
    + runtimeRecords.filter((record) => record.status === "running").length;
  const failed = items.filter((item) => failedStatuses.has(item.status)).length
    + runtimeRecords.filter((record) => record.status === "failed").length;
  const waiting = items.filter((item) => waitingStatuses.has(item.status)).length;
  const now = Date.now();
  const overdue = items.filter((item) => (
    !completedStatuses.has(item.status)
      && !failedStatuses.has(item.status)
      && item.dueAt !== null
      && item.dueAt < now
  )).length;
  return {
    total: items.length + runtimeRecords.length,
    completed,
    active,
    waiting,
    failed,
    overdue,
    completion: items.length + runtimeRecords.length
      ? Math.round((completed / (items.length + runtimeRecords.length)) * 100)
      : 0,
    failureRate: items.length + runtimeRecords.length
      ? Math.round((failed / (items.length + runtimeRecords.length)) * 100)
      : 0,
  };
}

function Metric({ label, value, tone = "default", title }: { label: string; value: number | string; tone?: "default" | "warning" | "success" | "danger"; title?: string }) {
  return (
    <div className="min-w-0 border-e border-dls-border/70 pe-5 last:border-e-0 last:pe-0" title={title}>
      <div className={cn(
        "text-[22px] font-semibold tracking-[-0.7px] tabular-nums",
        tone === "warning" && "text-amber-11",
        tone === "success" && "text-emerald-11",
        tone === "danger" && "text-rose-11",
      )}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-dls-tertiary">{label}</div>
    </div>
  );
}

function TaskMetric({ id, metrics }: { id: ProjectTaskHealthMetric; metrics: ReturnType<typeof taskMetrics> }) {
  switch (id) {
    case "total":
      return <Metric label={t("project_overview.total_tasks")} value={metrics.total} />;
    case "waiting":
      return <Metric label={t("project_overview.waiting")} value={metrics.waiting} />;
    case "completed":
      return <Metric label={t("project_overview.completed_tasks")} value={metrics.completed} tone={metrics.completed ? "success" : "default"} />;
    case "failureRate":
      return <Metric label={t("project_overview.failure_rate")} value={`${metrics.failureRate}%`} tone={metrics.failed ? "danger" : "default"} />;
    case "overdue":
      return <Metric label={t("project_overview.overdue")} value={metrics.overdue} tone={metrics.overdue ? "warning" : "default"} />;
    case "active":
      return <Metric label={t("project_overview.active_tasks")} value={metrics.active} />;
  }
}

function tasksForAgent(agent: ProjectAgent, items: WorkItem[]): WorkItem[] {
  const agentId = agent.id.trim().toLowerCase();
  const agentName = agent.name.trim().toLowerCase();
  return items.filter((item) => {
    if (item.execution) return item.execution.agent.id === agent.id;
    const assignee = item.assignee?.trim().toLowerCase();
    return assignee === agentId || assignee === agentName;
  });
}

export function ProjectDashboard(props: ProjectDashboardProps) {
  const selectedAgent = props.selectedAgent;
  const metrics = taskMetrics(
    props.items,
    props.config,
    props.runtimeMetrics?.executionRecords ?? [],
  );
  const sections = new Set(props.config.dashboard.sections);
  const hasLeftRail = sections.has("health") || sections.has("tasks") || sections.has("usage") || sections.has("orchestration");
  const hasRightRail = sections.has("agents") || sections.has("schedule");
  const installedById = new Map(props.plugins.map((item) => [item.pluginId, item]));
  const referencedPluginIds = Array.from(new Set(props.config.agents.flatMap((agent) => agent.pluginIds)));
  const missingConnections = referencedPluginIds.filter((pluginId) => {
    const item = installedById.get(pluginId);
    return !item || pluginNeedsConfiguration(item, props.authorizations[pluginId]);
  });
  const health = metrics.failed > 0
    ? { label: t("project_overview.health_failure"), description: t("project_overview.health_failure_description", { count: metrics.failed }), tone: "rose" }
    : missingConnections.length > 0
      ? { label: t("project_overview.health_setup"), description: t("project_overview.health_setup_description", { count: missingConnections.length }), tone: "violet" }
      : metrics.overdue > 0
        ? { label: t("project_overview.health_attention"), description: t("project_overview.health_attention_description", { count: metrics.overdue }), tone: "amber" }
        : { label: t("project_overview.health_good"), description: t("project_overview.health_good_description"), tone: "green" };
  const recentItems = [...props.items].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 5);
  const upcomingItems = props.items
    .filter((item) => item.startAt !== null || item.dueAt !== null)
    .sort((left, right) => (left.startAt ?? left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.startAt ?? right.dueAt ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 4);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_10%_0%,rgba(74,158,178,0.10),transparent_30%),radial-gradient(circle_at_92%_6%,rgba(108,120,163,0.07),transparent_28%),var(--dls-surface)] text-dls-text" data-testid="project-overview">
      <header className="shrink-0 border-b border-white/25 bg-dls-surface/68 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.06] sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-dls-secondary" />
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.45px]">{props.projectName}</h1>
              <span className="rounded-full bg-dls-hover px-2 py-0.5 text-[9px] font-medium text-dls-tertiary">{t("project_overview.title")}</span>
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-dls-secondary">
              {props.config.goal || t("project_overview.default_goal")}
            </p>
          </div>
          <div className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-sm backdrop-blur-xl",
            health.tone === "green" && "border-emerald-6/50 bg-emerald-3/70 text-emerald-11",
            health.tone === "amber" && "border-amber-6/50 bg-amber-3/70 text-amber-11",
            health.tone === "violet" && "border-violet-6/50 bg-violet-3/70 text-violet-11",
            health.tone === "rose" && "border-rose-6/50 bg-rose-3/70 text-rose-11",
          )}>
            {health.tone === "green" ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            <span className="font-medium">{health.label}</span>
          </div>
        </div>
      </header>

      <main className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        <div className={cn(
          "mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-4",
          hasLeftRail && hasRightRail && "xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]",
        )}>
          {hasLeftRail ? (
          <div className="min-w-0 space-y-4">
            {sections.has("health") ? (
            <section className="rounded-2xl border border-white/35 bg-dls-surface/76 p-4 shadow-[0_18px_50px_rgba(31,50,72,0.07),inset_0_1px_0_rgba(255,255,255,0.55)] backdrop-blur-xl dark:border-white/[0.065]" data-testid="project-task-health">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-[12px] font-medium">
                    <Activity className="size-4 text-dls-secondary" />{t("project_overview.task_health")}
                  </div>
                  <p className="mt-1 text-[10px] text-dls-tertiary">{health.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-[24px] font-semibold tracking-[-0.8px] tabular-nums">{metrics.completion}%</div>
                  <div className="text-[9px] text-dls-tertiary">{t("project_overview.completion")}</div>
                </div>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-dls-hover">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${metrics.completion}%` }} />
              </div>
              <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-4">
                {props.config.dashboard.taskHealth.metrics.map((metric) => (
                  <TaskMetric key={metric} id={metric} metrics={metrics} />
                ))}
              </div>
            </section>
            ) : null}

            {sections.has("tasks") ? (
            <section className="overflow-hidden rounded-2xl border border-dls-border/80 bg-dls-surface/84">
              <header className="flex items-center justify-between gap-3 border-b border-dls-border/70 px-4 py-3">
                <div>
                  <h2 className="text-[12px] font-medium">{t("project_overview.task_activity")}</h2>
                  <p className="mt-0.5 text-[9px] text-dls-tertiary">{t("project_overview.task_activity_description")}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg text-[11px]" onClick={props.onOpenTasks}>
                  {t("project_overview.open_tasks")}<ArrowUpRight className="size-3.5" />
                </Button>
              </header>
              {recentItems.length ? (
                <div className="divide-y divide-dls-border/60">
                  {recentItems.map((item) => {
                    const column = props.board.columns.find((candidate) => candidate.id === item.status);
                    return (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                        <CircleDot className="size-3.5 shrink-0 text-dls-tertiary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium">{item.title}</p>
                          <p className="mt-0.5 truncate text-[9px] text-dls-tertiary">{item.assignee || t("project_overview.unassigned")}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-dls-hover px-2 py-1 text-[9px] text-dls-secondary">{column?.label || item.status}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <button type="button" className="flex w-full flex-col items-center px-5 py-10 text-center hover:bg-dls-hover/30" onClick={props.onOpenTasks}>
                  <CheckCircle2 className="size-5 text-dls-tertiary" />
                  <span className="mt-2 text-xs font-medium">{t("project_overview.no_tasks")}</span>
                  <span className="mt-1 text-[10px] text-dls-tertiary">{t("project_overview.no_tasks_description")}</span>
                </button>
              )}
            </section>
            ) : null}

            {sections.has("usage") ? <ProjectRuntimeData
              agents={props.config.agents}
              displayMetrics={props.config.dashboard.usage.metrics}
              metrics={props.runtimeMetrics}
              loading={props.runtimeMetricsLoading}
              error={props.runtimeMetricsError}
            /> : null}
            {sections.has("orchestration") ? <ProjectOrchestrationGraph
              config={props.config}
              items={props.items}
              runtimeMetrics={props.runtimeMetrics}
              onOpenAgent={props.onOpenAgent}
            /> : null}
          </div>
          ) : null}

          {hasRightRail ? (
          <div className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
            {sections.has("agents") ? (
            <section className="overflow-hidden rounded-2xl border border-white/35 bg-dls-surface/78 shadow-[0_16px_46px_rgba(31,50,72,0.055),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-xl dark:border-white/[0.065]" data-testid="project-agent-activity-panel">
              <header className="flex items-center justify-between gap-3 border-b border-dls-border/70 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-dls-secondary" />
                  <h2 className="text-[12px] font-medium">{t("project_overview.agents")}</h2>
                  <span className="text-[9px] tabular-nums text-dls-tertiary">{props.config.agents.length}</span>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-lg" aria-label={t("project_overview.add_agent")} onClick={props.onAddAgent}>
                  <Plus className="size-3.5" />
                </Button>
              </header>
              <div className="divide-y divide-dls-border/60" data-testid="project-agent-list">
                {props.config.agents.map((agent) => {
                  const assignedItems = tasksForAgent(agent, props.items).sort((left, right) => right.updatedAt - left.updatedAt);
                  const runtimeUsage = props.runtimeMetrics?.agents.find((usage) => usage.agentId === agent.id);
                  const recentRuntimeConversation = runtimeUsage?.recentConversation ?? null;
                  const agentMetrics = taskMetrics(assignedItems, props.config);
                  const activeStatuses = new Set(props.config.dashboard.taskHealth.statusGroups.active);
                  const completedStatuses = new Set(props.config.dashboard.taskHealth.statusGroups.completed);
                  const failedStatuses = new Set(props.config.dashboard.taskHealth.statusGroups.failed);
                  const recentItem = assignedItems.find((item) => activeStatuses.has(item.status))
                    ?? assignedItems.find((item) => completedStatuses.has(item.status) || failedStatuses.has(item.status));
                  const recentColumn = recentItem ? props.board.columns.find((column) => column.id === recentItem.status) : undefined;
                  const taskSegments = [
                    { id: "active", count: agentMetrics.active + (runtimeUsage?.executions.running ?? 0), className: "bg-amber-9", label: t("project_overview.active_tasks") },
                    { id: "completed", count: agentMetrics.completed + (runtimeUsage?.executions.completed ?? 0), className: "bg-emerald-9", label: t("project_overview.completed_tasks") },
                    { id: "failed", count: agentMetrics.failed + (runtimeUsage?.executions.failed ?? 0), className: "bg-rose-9", label: t("project_overview.failed_tasks") },
                  ];
                  const displayedTaskTotal = taskSegments.reduce((total, segment) => total + segment.count, 0);
                  const agentTaskState = recentItem && activeStatuses.has(recentItem.status)
                    ? t("project_overview.active_tasks")
                    : recentItem && failedStatuses.has(recentItem.status)
                      ? t("project_overview.failed_tasks")
                      : recentItem
                        ? t("project_overview.completed_tasks")
                        : recentRuntimeConversation?.status === "running"
                          ? t("project_overview.active_tasks")
                          : recentRuntimeConversation?.status === "completed"
                            ? t("project_overview.completed_tasks")
                            : recentRuntimeConversation?.status === "failed"
                              ? t("project_overview.failed_tasks")
                              : recentRuntimeConversation
                                ? t("project_overview.execution_recorded")
                                : t("project_overview.standby");
                  const primary = agent.id === props.config.orchestration.entryAgentId;
                  const agentNeedsSetup = agent.pluginIds.some((pluginId) => {
                    const item = installedById.get(pluginId);
                    return !item || pluginNeedsConfiguration(item, props.authorizations[pluginId]);
                  });
                  const selected = agent.id === selectedAgent?.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "group block w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selected ? "bg-dls-hover/52" : "hover:bg-dls-hover/34",
                      )}
                      onClick={() => props.onOpenAgent(agent)}
                      data-testid="project-agent-tab"
                    >
                      <span className="flex items-start gap-3">
                        <AgentAvatar agent={agent} className="size-9" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[12px] font-medium">{agent.name}</span>
                            {primary ? <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[8px] font-medium text-primary">{t("project_overview.primary")}</span> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[9px] text-dls-tertiary">{agent.role || t("project_overview.agent_no_role")}</span>
                        </span>
                        <Settings2 className="mt-0.5 size-3.5 shrink-0 text-dls-tertiary transition-colors group-hover:text-dls-text" />
                      </span>
                      <span className="mt-3 flex items-center gap-2 rounded-xl bg-dls-hover/46 px-2.5 py-2">
                        <ListTodo className="size-3.5 shrink-0 text-dls-tertiary" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[8px] font-medium uppercase tracking-[0.08em] text-dls-tertiary">{t("project_overview.recent_task")}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-dls-secondary">
                            {recentItem?.title || recentRuntimeConversation?.title || t("project_overview.no_agent_tasks")}
                          </span>
                        </span>
                        {recentItem || recentRuntimeConversation ? (
                          <span className="shrink-0 rounded-full bg-dls-surface/80 px-2 py-0.5 text-[8px] text-dls-tertiary">
                            {recentItem
                              ? recentColumn?.label || recentItem.status
                              : recentRuntimeConversation?.status === "running"
                                ? t("project_overview.active_tasks")
                                : recentRuntimeConversation?.status === "completed"
                                  ? t("project_overview.completed_tasks")
                                  : recentRuntimeConversation?.status === "failed"
                                    ? t("project_overview.failed_tasks")
                                    : t("project_overview.execution_recorded")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2.5 block" data-testid="project-agent-task-summary">
                        <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-dls-hover" aria-label={t("project_overview.agent_task_distribution", { count: displayedTaskTotal })}>
                          {displayedTaskTotal ? taskSegments.map((segment) => segment.count ? (
                            <span
                              key={segment.id}
                              className={cn("h-full", segment.className)}
                              style={{ width: `${(segment.count / displayedTaskTotal) * 100}%` }}
                              title={`${segment.label} ${segment.count}`}
                            />
                          ) : null) : null}
                        </span>
                        <span className="mt-2 grid grid-cols-3 gap-1 text-[8px] text-dls-tertiary">
                          {taskSegments.map((segment) => (
                            <span key={segment.id} className="flex min-w-0 items-center gap-1" title={segment.label}>
                              <span className={cn("size-1.5 shrink-0 rounded-full", segment.className)} />
                              <span className="truncate">{segment.label}</span>
                              <span className="ms-auto tabular-nums text-dls-secondary">{segment.count}</span>
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="mt-2.5 flex items-center gap-3 text-[9px] text-dls-tertiary">
                        <span className="inline-flex items-center gap-1"><Package className="size-3" />{t("project_overview.plugin_count", { count: agent.pluginIds.length })}</span>
                        <span className="inline-flex items-center gap-1"><Sparkles className="size-3" />{t("project_overview.skill_count", { count: agent.skillIds.length })}</span>
                        <span className={cn("ms-auto flex items-center gap-1", agentNeedsSetup ? "text-amber-11" : "text-dls-tertiary")}>
                          {agentNeedsSetup ? <KeyRound className="size-3" /> : null}
                          {agentNeedsSetup ? t("project_overview.needs_configuration") : agentTaskState}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            ) : null}

            {sections.has("schedule") ? (
            <section
              className="overflow-hidden rounded-2xl border border-white/35 bg-dls-surface/78 shadow-[0_16px_46px_rgba(31,50,72,0.055),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-xl dark:border-white/[0.065]"
              data-testid="project-upcoming"
            >
              <header className="flex items-center gap-2 border-b border-dls-border/70 px-4 py-3">
                <CalendarClock className="size-4 text-dls-secondary" />
                <h2 className="text-[12px] font-medium">{t("project_overview.upcoming")}</h2>
              </header>
              {upcomingItems.length ? <div className="divide-y divide-dls-border/60">
                {upcomingItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-dls-hover text-dls-secondary"><Clock3 className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium">{item.title}</p>
                      <p className="mt-0.5 text-[9px] text-dls-tertiary">{formatDate(item.startAt ?? item.dueAt)}</p>
                    </div>
                  </div>
                ))}
              </div> : <p className="px-4 py-6 text-center text-[10px] text-dls-tertiary">{t("project_overview.no_upcoming")}</p>}
            </section>
            ) : null}
          </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
