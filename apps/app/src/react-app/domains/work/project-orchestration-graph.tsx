/** @jsxImportSource react */
import type {
  ProjectAgent,
  ProjectAgentRelation,
  ProjectWorkspaceConfig,
} from "@ipollowork/types/project-workspace";
import type { WorkItem } from "@ipollowork/types/work-items";
import { Network } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "./project-overview-shared";
import type { ProjectRuntimeMetrics } from "./project-runtime-metrics";

type ProjectOrchestrationGraphProps = {
  config: ProjectWorkspaceConfig;
  items: WorkItem[];
  runtimeMetrics: ProjectRuntimeMetrics | null;
  onOpenAgent: (agent: ProjectAgent) => void;
};

type GraphNode = {
  agent: ProjectAgent;
  level: number;
  x: number;
  y: number;
  taskCount: number;
};

type GraphEdge = {
  relation: ProjectAgentRelation;
  source: GraphNode;
  target: GraphNode;
  path: string;
  labelX: number;
  labelY: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
};

type GraphStage = {
  level: number;
  index: number;
  x: number;
  y: number;
  parallel: boolean;
};

const NODE_WIDTH = 184;
const NODE_HEIGHT = 66;
const COLUMN_GAP = 86;
const ROW_GAP = 20;
const CANVAS_PADDING = 30;
const PARALLEL_ROUTE_GUTTER = 44;

function assignedTaskCount(agent: ProjectAgent, items: WorkItem[], metrics: ProjectRuntimeMetrics | null): number {
  const identities = new Set([agent.id, agent.name].map((value) => value.trim().toLowerCase()));
  const workItems = items.filter((item) => {
    if (item.execution) return item.execution.agent.id === agent.id;
    return item.assignee && identities.has(item.assignee.trim().toLowerCase());
  }).length;
  const runtimeUsage = metrics?.agents.find((usage) => usage.agentId === agent.id);
  return workItems
    + (runtimeUsage?.executions.running ?? 0)
    + (runtimeUsage?.executions.completed ?? 0)
    + (runtimeUsage?.executions.failed ?? 0);
}

function graphLevels(config: ProjectWorkspaceConfig): Map<string, number> {
  const agentIds = new Set(config.agents.map((agent) => agent.id));
  const parent = new Map(config.agents.map((agent) => [agent.id, agent.id]));
  const find = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current) ?? current;
    return current;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const relation of config.orchestration.relations) {
    if (relation.type === "parallel" && agentIds.has(relation.sourceAgentId) && agentIds.has(relation.targetAgentId)) {
      union(relation.sourceAgentId, relation.targetAgentId);
    }
  }

  const entryGroup = find(config.orchestration.entryAgentId);
  const groupLevels = new Map<string, number>();
  for (const agent of config.agents) groupLevels.set(find(agent.id), find(agent.id) === entryGroup ? 0 : 1);

  for (let pass = 0; pass < config.agents.length; pass += 1) {
    let changed = false;
    for (const relation of config.orchestration.relations) {
      if (relation.type !== "dependency") continue;
      const sourceGroup = find(relation.sourceAgentId);
      const targetGroup = find(relation.targetAgentId);
      if (sourceGroup === targetGroup) continue;
      const nextLevel = Math.min(config.agents.length, (groupLevels.get(sourceGroup) ?? 0) + 1);
      if (nextLevel > (groupLevels.get(targetGroup) ?? 0)) {
        groupLevels.set(targetGroup, nextLevel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return new Map(config.agents.map((agent) => [agent.id, groupLevels.get(find(agent.id)) ?? 1]));
}

function edgePath(
  source: GraphNode,
  target: GraphNode,
  parallel: boolean,
): Pick<GraphEdge, "path" | "labelX" | "labelY" | "sourceX" | "sourceY" | "targetX" | "targetY"> {
  const sourceCenterY = source.y + NODE_HEIGHT / 2;
  const targetCenterY = target.y + NODE_HEIGHT / 2;
  if (parallel || source.level === target.level) {
    const sourceX = source.x + NODE_WIDTH;
    const targetX = target.x + NODE_WIDTH;
    const routeX = Math.max(sourceX, targetX) + PARALLEL_ROUTE_GUTTER - 8;
    return {
      path: `M ${sourceX} ${sourceCenterY} C ${routeX} ${sourceCenterY}, ${routeX} ${targetCenterY}, ${targetX} ${targetCenterY}`,
      labelX: routeX + 1,
      labelY: (sourceCenterY + targetCenterY) / 2,
      sourceX,
      sourceY: sourceCenterY,
      targetX,
      targetY: targetCenterY,
    };
  }

  const sourceX = source.x + NODE_WIDTH;
  const targetX = target.x;
  const midpointX = (sourceX + targetX) / 2;
  return {
    path: `M ${sourceX} ${sourceCenterY} C ${midpointX} ${sourceCenterY}, ${midpointX} ${targetCenterY}, ${targetX} ${targetCenterY}`,
    labelX: midpointX,
    labelY: (sourceCenterY + targetCenterY) / 2,
    sourceX,
    sourceY: sourceCenterY,
    targetX,
    targetY: targetCenterY,
  };
}

function layoutGraph(config: ProjectWorkspaceConfig, items: WorkItem[], metrics: ProjectRuntimeMetrics | null) {
  const levels = graphLevels(config);
  const columns = new Map<number, ProjectAgent[]>();
  for (const agent of config.agents) {
    const level = levels.get(agent.id) ?? 1;
    columns.set(level, [...(columns.get(level) ?? []), agent]);
  }
  const orderedLevels = [...columns.keys()].sort((left, right) => left - right);
  const maxRows = Math.max(1, ...[...columns.values()].map((agents) => agents.length));
  const canvasHeight = Math.max(176, CANVAS_PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP);
  const canvasWidth = Math.max(
    520,
    CANVAS_PADDING * 2
      + orderedLevels.length * NODE_WIDTH
      + Math.max(0, orderedLevels.length - 1) * COLUMN_GAP
      + PARALLEL_ROUTE_GUTTER,
  );
  const nodes: GraphNode[] = [];
  const stages: GraphStage[] = [];

  orderedLevels.forEach((level, columnIndex) => {
    const agents = columns.get(level) ?? [];
    const columnHeight = agents.length * NODE_HEIGHT + Math.max(0, agents.length - 1) * ROW_GAP;
    const startY = Math.max(CANVAS_PADDING, (canvasHeight - columnHeight) / 2);
    stages.push({
      level,
      index: columnIndex + 1,
      x: CANVAS_PADDING + columnIndex * (NODE_WIDTH + COLUMN_GAP),
      y: Math.max(6, startY - 23),
      parallel: agents.length > 1,
    });
    agents.forEach((agent, rowIndex) => {
      nodes.push({
        agent,
        level,
        x: CANVAS_PADDING + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: startY + rowIndex * (NODE_HEIGHT + ROW_GAP),
        taskCount: assignedTaskCount(agent, items, metrics),
      });
    });
  });

  const nodesById = new Map(nodes.map((node) => [node.agent.id, node]));
  const edges = config.orchestration.relations.flatMap((relation): GraphEdge[] => {
    const source = nodesById.get(relation.sourceAgentId);
    const target = nodesById.get(relation.targetAgentId);
    if (!source || !target) return [];
    return [{ relation, source, target, ...edgePath(source, target, relation.type === "parallel") }];
  });

  return { canvasHeight, canvasWidth, edges, nodes, stages };
}

export function ProjectOrchestrationGraph(props: ProjectOrchestrationGraphProps) {
  const graph = layoutGraph(props.config, props.items, props.runtimeMetrics);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/35 bg-dls-surface/76 shadow-[0_18px_50px_rgba(31,50,72,0.06),inset_0_1px_0_rgba(255,255,255,0.52)] backdrop-blur-xl dark:border-white/[0.065]"
      data-testid="project-orchestration-graph"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-dls-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-dls-secondary" />
          <div>
            <h2 className="text-[12px] font-medium">{t("project_overview.orchestration")}</h2>
            <p className="mt-0.5 text-[9px] text-dls-tertiary">{t("project_overview.orchestration_description")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[8px] text-dls-tertiary">
          <span className="flex items-center gap-1.5"><span className="h-px w-5 bg-primary/65" />{t("project_overview.dependency")}</span>
          <span className="flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-violet-9/65" />{t("project_overview.parallel")}</span>
        </div>
      </header>

      <div className="no-scrollbar overflow-x-auto p-3" data-testid="project-orchestration-agents">
        <div className="relative" style={{ height: graph.canvasHeight, minWidth: graph.canvasWidth }}>
          {graph.stages.filter((stage) => stage.parallel).map((stage) => (
            <div
              key={`parallel-group:${stage.level}`}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-2xl border border-dashed border-violet-9/20 bg-violet-9/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.38)]"
              data-testid="project-orchestration-parallel-group"
              style={{
                height: graph.canvasHeight - 20,
                left: stage.x - 10,
                top: 10,
                width: NODE_WIDTH + 20,
              }}
            />
          ))}

          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible text-dls-tertiary"
            data-testid="project-orchestration-relations"
            height={graph.canvasHeight}
            viewBox={`0 0 ${graph.canvasWidth} ${graph.canvasHeight}`}
            width={graph.canvasWidth}
          >
            {graph.edges.map((edge) => {
              const parallel = edge.relation.type === "parallel";
              const label = edge.relation.label || (parallel ? t("project_overview.parallel") : t("project_overview.dependency"));
              const labelWidth = Math.max(28, Math.min(82, label.length * 8 + 12));
              return (
                <g key={`${edge.relation.type}:${edge.relation.sourceAgentId}:${edge.relation.targetAgentId}`}>
                  <path
                    className="text-dls-surface"
                    d={edge.path}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="5"
                  />
                  <path
                    className={parallel ? "text-violet-9/60" : "text-primary/62"}
                    data-edge-source={edge.relation.sourceAgentId}
                    data-edge-target={edge.relation.targetAgentId}
                    data-edge-type={edge.relation.type}
                    d={edge.path}
                    fill="none"
                    stroke="currentColor"
                    strokeDasharray={parallel ? "4 5" : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={parallel ? "1.4" : "1.55"}
                  />
                  {!parallel ? (
                    <path
                      className="text-primary/70"
                      d={`M ${edge.targetX - 8} ${edge.targetY - 4} L ${edge.targetX - 3} ${edge.targetY} L ${edge.targetX - 8} ${edge.targetY + 4}`}
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.55"
                    />
                  ) : null}
                  <circle
                    className={parallel ? "fill-violet-9/70" : "fill-primary/75"}
                    cx={edge.sourceX}
                    cy={edge.sourceY}
                    data-testid="project-orchestration-port"
                    r="2"
                  />
                  <circle
                    className={parallel ? "fill-violet-9/70" : "fill-primary/75"}
                    cx={edge.targetX}
                    cy={edge.targetY}
                    data-testid="project-orchestration-port"
                    r="2"
                  />
                  <g>
                    <rect
                      className="fill-dls-surface/95 stroke-dls-border/55"
                      height="16"
                      rx="8"
                      width={labelWidth}
                      x={edge.labelX - labelWidth / 2}
                      y={edge.labelY - 8}
                    />
                    <text
                      className={parallel ? "fill-violet-11 text-[7px]" : "fill-dls-secondary text-[7px]"}
                      dominantBaseline="middle"
                      textAnchor="middle"
                      x={edge.labelX}
                      y={edge.labelY}
                    >
                      {label}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {graph.stages.map((stage) => (
            <span
              key={stage.level}
              className={cn(
                "pointer-events-none absolute z-10 inline-flex h-4 items-center gap-1 rounded-full border bg-dls-surface/82 px-2 text-[7px] font-medium backdrop-blur-md",
                stage.parallel ? "border-violet-9/20 text-violet-11" : "border-primary/15 text-dls-tertiary",
              )}
              data-stage-type={stage.parallel ? "parallel" : "sequential"}
              data-testid="project-orchestration-stage"
              style={{ left: stage.x, top: stage.y }}
            >
              <span className={cn("size-1 rounded-full", stage.parallel ? "bg-violet-9" : "bg-primary/65")} />
              {stage.parallel
                ? t("project_overview.parallel_stage")
                : t("project_overview.sequential_stage", { index: stage.index })}
            </span>
          ))}

          {graph.nodes.map((node) => {
            const primary = node.agent.id === props.config.orchestration.entryAgentId;
            return (
              <button
                key={node.agent.id}
                type="button"
                className={cn(
                  "absolute z-10 flex items-center gap-2.5 rounded-xl border bg-dls-surface/92 px-3 text-left shadow-[0_8px_26px_rgba(31,50,72,0.055)] transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  primary ? "border-primary/35" : "border-dls-border/75",
                )}
                onClick={() => props.onOpenAgent(node.agent)}
                style={{ height: NODE_HEIGHT, left: node.x, top: node.y, width: NODE_WIDTH }}
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-[3px] top-1/2 size-1.5 -translate-y-1/2 rounded-full border border-primary/25 bg-dls-surface shadow-[0_0_0_2px_color-mix(in_srgb,var(--dls-surface)_82%,transparent)]"
                />
                <span
                  aria-hidden="true"
                  className="absolute -right-[3px] top-1/2 size-1.5 -translate-y-1/2 rounded-full border border-primary/25 bg-dls-surface shadow-[0_0_0_2px_color-mix(in_srgb,var(--dls-surface)_82%,transparent)]"
                />
                <AgentAvatar agent={node.agent} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[10px] font-medium">{node.agent.name}</span>
                    {primary ? <span className="rounded bg-primary/10 px-1 py-0.5 text-[7px] text-primary">{t("project_overview.entry")}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[8px] text-dls-tertiary">{node.agent.role || t("project_overview.agent_no_role")}</span>
                  <span className="mt-1 block text-[7px] tabular-nums text-dls-tertiary">{t("project_overview.assigned_task_count", { count: node.taskCount })}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {graph.edges.length === 0 ? (
        <p className="border-t border-dls-border/60 px-4 py-2.5 text-[9px] text-dls-tertiary">
          {t("project_overview.no_orchestration_relations_description")}
        </p>
      ) : null}
    </section>
  );
}
