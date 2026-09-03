/** @jsxImportSource react */
import type { ProjectAgent, ProjectUsageMetric } from "@ipollowork/types/project-workspace";
import { BarChart3, CircleGauge, MessageCircle, Sigma } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import type { ProjectRuntimeMetrics } from "./project-runtime-metrics";

type ProjectRuntimeDataProps = {
  agents: ProjectAgent[];
  displayMetrics: ProjectUsageMetric[];
  metrics: ProjectRuntimeMetrics | null;
  loading: boolean;
  error: boolean;
};

function formatTokens(value: number | null): string {
  if (value === null) return "--";
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

function usageColor(index: number): string {
  switch (index % 6) {
    case 0: return "bg-primary";
    case 1: return "bg-violet-9";
    case 2: return "bg-amber-9";
    case 3: return "bg-emerald-9";
    case 4: return "bg-rose-9";
    default: return "bg-cyan-9";
  }
}

function usagePercentage(tokens: number, totalTokens: number): number {
  return totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
}

function formatPercentage(value: number): string {
  if (value === 0) return "0%";
  return value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

function DataMetric(props: {
  icon: typeof Sigma;
  label: string;
  value: string;
  detail: string;
}) {
  const Icon = props.icon;
  return (
    <div className="min-w-0 border-e border-dls-border/60 pe-3 last:border-e-0 last:pe-0">
      <div className="flex items-center gap-2 text-[11px] leading-[15px] text-dls-text/45">
        <Icon className="size-3" />
        <span className="truncate">{props.label}</span>
      </div>
      <div className="mt-1 text-[18px] font-semibold tracking-[-0.5px] tabular-nums">{props.value}</div>
      <p className="mt-0.5 truncate text-[11px] leading-[15px] text-dls-text/45">{props.detail}</p>
    </div>
  );
}

export function ProjectRuntimeData(props: ProjectRuntimeDataProps) {
  const metrics = props.metrics;
  const summaryMetrics = props.displayMetrics.filter(
    (metric): metric is Exclude<ProjectUsageMetric, "agentUsage"> => metric !== "agentUsage",
  );
  const showAgentUsage = props.displayMetrics.includes("agentUsage");
  const unavailable = props.error || metrics?.status === "unavailable";
  const totalTokens = metrics?.totalTokens ?? null;
  const usageByAgent = new Map(metrics?.agents.map((agent) => [agent.agentId, agent]) ?? []);
  const usageSegments = props.agents.map((agent, index) => {
    const usage = usageByAgent.get(agent.id);
    return {
      id: agent.id,
      label: agent.name,
      tokens: usage?.attributed ? usage.tokens : 0,
      color: usageColor(index),
    };
  });
  if (metrics?.unattributedTokens !== null && metrics?.unattributedTokens !== undefined && metrics.unattributedTokens > 0) {
    usageSegments.push({
      id: "unattributed",
      label: t("project_overview.not_attributed"),
      tokens: metrics.unattributedTokens,
      color: "bg-dls-tertiary/45",
    });
  }
  const statusLabel = props.loading
    ? t("project_overview.runtime_data_loading")
    : props.error
      ? t("project_overview.runtime_data_error")
      : metrics?.status === "partial"
        ? t("project_overview.runtime_data_partial", { count: metrics.unmeteredConversationCount })
        : unavailable
          ? t("project_overview.runtime_data_unavailable")
          : null;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-dls-border/70 bg-white dark:bg-dls-surface"
      data-testid="project-runtime-data"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-dls-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-dls-secondary" />
          <h2 className="text-[14px] font-semibold leading-5 text-dls-text">{t("project_overview.runtime_data")}</h2>
        </div>
        {statusLabel ? <span className={cn(
          "rounded-full px-2.5 py-1 text-[11px] leading-[15px]",
          unavailable ? "bg-dls-hover text-dls-text/45" : metrics?.status === "partial" ? "bg-amber-3 text-amber-11" : "bg-emerald-3 text-emerald-11",
        )}>{statusLabel}</span> : null}
      </header>

      <div className="p-4">
        {summaryMetrics.length ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${summaryMetrics.length}, minmax(0, 1fr))` }}>
            {summaryMetrics.map((metric) => {
              if (metric === "totalTokens") {
                return <DataMetric
                  key={metric}
                  icon={Sigma}
                  label={t("project_overview.total_token_usage")}
                  value={props.loading ? "···" : formatTokens(totalTokens)}
                  detail={metrics?.status === "partial" ? t("project_overview.metered_conversations", { count: metrics.meteredConversationCount }) : t("project_overview.all_project_conversations")}
                />;
              }
              if (metric === "conversations") {
                return <DataMetric
                  key={metric}
                  icon={MessageCircle}
                  label={t("project_overview.total_conversations")}
                  value={props.loading ? "···" : (metrics?.conversationCount ?? 0).toLocaleString()}
                  detail={t("project_overview.workspace_conversations")}
                />;
              }
              return <DataMetric
                key={metric}
                icon={CircleGauge}
                label={t("project_overview.average_tokens")}
                value={props.loading ? "···" : formatTokens(metrics?.averageTokensPerConversation ?? null)}
                detail={t("project_overview.per_metered_conversation")}
              />;
            })}
          </div>
        ) : null}

        {showAgentUsage ? <div className={cn(summaryMetrics.length && "mt-3 border-t border-dls-border/60 pt-3")} data-testid="project-agent-usage-chart">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold leading-5 text-dls-text">{t("project_overview.agent_usage")}</h3>
            <div className="shrink-0 text-right">
              <p className="text-[11px] leading-[15px] text-dls-text/45">{t("project_overview.total_token_usage")}</p>
              <p className="text-[13px] font-semibold tabular-nums">{props.loading ? "···" : formatTokens(totalTokens)}</p>
            </div>
          </div>

          <div
            aria-label={t("project_overview.agent_usage")}
            className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-dls-hover"
            role="img"
          >
            {usageSegments.filter((segment) => segment.tokens > 0).map((segment) => {
              const percentage = usagePercentage(segment.tokens, totalTokens ?? 0);
              return (
                <span
                  key={segment.id}
                  className={cn("h-full transition-[width] duration-300", segment.color)}
                  style={{ width: `${percentage}%` }}
                  title={`${segment.label} · ${formatTokens(segment.tokens)} · ${formatPercentage(percentage)}`}
                />
              );
            })}
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {usageSegments.map((segment) => {
              const percentage = usagePercentage(segment.tokens, totalTokens ?? 0);
              return (
                <div key={segment.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 text-[11px] leading-[15px]">
                  <span className={cn("size-2 rounded-sm", segment.color)} />
                  <span className="truncate font-medium">{segment.label}</span>
                  <span className="tabular-nums text-dls-secondary">{formatTokens(segment.tokens)}</span>
                  <span className="w-9 text-right tabular-nums text-dls-text/45">{formatPercentage(percentage)}</span>
                </div>
              );
            })}
          </div>
        </div> : null}
      </div>
    </section>
  );
}
