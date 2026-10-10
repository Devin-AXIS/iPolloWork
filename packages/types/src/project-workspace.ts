import { z } from "zod";

const projectIdSchema = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const projectTaskStatusSchema = z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/);

export const PROJECT_DASHBOARD_SECTIONS = [
  "health",
  "usage",
  "agents",
  "orchestration",
  "tasks",
  "schedule",
] as const;

export const PROJECT_TASK_HEALTH_METRICS = [
  "total",
  "waiting",
  "completed",
  "failureRate",
  "overdue",
  "active",
] as const;

export const PROJECT_USAGE_METRICS = [
  "totalTokens",
  "conversations",
  "averageTokens",
  "agentUsage",
] as const;

export const projectTaskHealthMetricSchema = z.enum(PROJECT_TASK_HEALTH_METRICS);
export const projectUsageMetricSchema = z.enum(PROJECT_USAGE_METRICS);

function defaultTaskStatusGroups() {
  return {
    waiting: ["planned", "ready"],
    active: ["running", "review"],
    completed: ["done"],
    failed: ["failed"],
  };
}

function defaultTaskHealthDashboard(): {
  metrics: Array<(typeof PROJECT_TASK_HEALTH_METRICS)[number]>;
  statusGroups: ReturnType<typeof defaultTaskStatusGroups>;
} {
  return {
    metrics: ["total", "waiting", "completed", "failureRate"],
    statusGroups: defaultTaskStatusGroups(),
  };
}

const projectTaskStatusGroupsSchema = z.object({
  waiting: z.array(projectTaskStatusSchema).max(8).default(["planned", "ready"]),
  active: z.array(projectTaskStatusSchema).max(8).default(["running", "review"]),
  completed: z.array(projectTaskStatusSchema).max(8).default(["done"]),
  failed: z.array(projectTaskStatusSchema).max(8).default(["failed"]),
});

export const projectAgentModelSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  modelId: z.string().trim().min(1).max(240),
});

export const projectAgentRuntimeSchema = z.object({
  engineId: z.string().trim().min(1).max(80).nullable().default(null),
  model: projectAgentModelSchema.nullable().default(null),
  mode: z.enum(["auto", "plan", "execute"]).default("auto"),
  modelVariant: z.string().trim().min(1).max(64).nullable().default(null),
});

export const projectAgentSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80),
  avatarSeed: z.string().trim().min(1).max(160),
  role: z.string().trim().max(240).default(""),
  prompt: z.string().trim().max(20_000).default(""),
  skillIds: z.array(z.string().trim().min(1).max(160)).max(64).default([]),
  pluginIds: z.array(z.string().trim().min(1).max(160)).max(64).default([]),
  runtime: projectAgentRuntimeSchema.default({
    engineId: null,
    model: null,
    mode: "auto",
    modelVariant: null,
  }),
});

export const projectAgentRelationSchema = z.object({
  sourceAgentId: projectIdSchema,
  targetAgentId: projectIdSchema,
  type: z.enum(["dependency", "parallel"]),
  label: z.string().trim().max(120).default(""),
});

export const projectWorkspaceConfigSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  goal: z.string().trim().max(2_000).default(""),
  agents: z.array(projectAgentSchema).min(1).max(24),
  orchestration: z.object({
    entryAgentId: projectIdSchema,
    relations: z.array(projectAgentRelationSchema).max(96).default([]),
  }),
  dashboard: z.object({
    sections: z.array(z.enum(PROJECT_DASHBOARD_SECTIONS)).min(1).max(PROJECT_DASHBOARD_SECTIONS.length),
    taskHealth: z.object({
      metrics: z.array(projectTaskHealthMetricSchema).min(1).max(PROJECT_TASK_HEALTH_METRICS.length),
      statusGroups: projectTaskStatusGroupsSchema.default(defaultTaskStatusGroups),
    }).default(defaultTaskHealthDashboard),
    usage: z.object({
      metrics: z.array(projectUsageMetricSchema).min(1).max(PROJECT_USAGE_METRICS.length),
    }).default({ metrics: [...PROJECT_USAGE_METRICS] }),
  }).default({
    sections: [...PROJECT_DASHBOARD_SECTIONS],
    taskHealth: defaultTaskHealthDashboard(),
    usage: { metrics: [...PROJECT_USAGE_METRICS] },
  }),
}).superRefine((value, context) => {
  const agentIds = value.agents.map((agent) => agent.id);
  if (new Set(agentIds).size !== agentIds.length) {
    context.addIssue({ code: "custom", path: ["agents"], message: "Agent IDs must be unique" });
  }
  if (!agentIds.includes(value.orchestration.entryAgentId)) {
    context.addIssue({ code: "custom", path: ["orchestration", "entryAgentId"], message: "Entry agent must reference an existing agent" });
  }
  const relationKeys = new Set<string>();
  value.orchestration.relations.forEach((relation, index) => {
    if (!agentIds.includes(relation.sourceAgentId)) {
      context.addIssue({ code: "custom", path: ["orchestration", "relations", index, "sourceAgentId"], message: "Relation source must reference an existing agent" });
    }
    if (!agentIds.includes(relation.targetAgentId)) {
      context.addIssue({ code: "custom", path: ["orchestration", "relations", index, "targetAgentId"], message: "Relation target must reference an existing agent" });
    }
    if (relation.sourceAgentId === relation.targetAgentId) {
      context.addIssue({ code: "custom", path: ["orchestration", "relations", index], message: "An agent cannot relate to itself" });
    }
    const pair = relation.type === "parallel"
      ? [relation.sourceAgentId, relation.targetAgentId].sort().join(":")
      : `${relation.sourceAgentId}:${relation.targetAgentId}`;
    const key = `${relation.type}:${pair}`;
    if (relationKeys.has(key)) {
      context.addIssue({ code: "custom", path: ["orchestration", "relations", index], message: "Agent relations must be unique" });
    }
    relationKeys.add(key);
  });
  if (new Set(value.dashboard.sections).size !== value.dashboard.sections.length) {
    context.addIssue({ code: "custom", path: ["dashboard", "sections"], message: "Dashboard sections must be unique" });
  }
  if (new Set(value.dashboard.taskHealth.metrics).size !== value.dashboard.taskHealth.metrics.length) {
    context.addIssue({ code: "custom", path: ["dashboard", "taskHealth", "metrics"], message: "Task health metrics must be unique" });
  }
  if (new Set(value.dashboard.usage.metrics).size !== value.dashboard.usage.metrics.length) {
    context.addIssue({ code: "custom", path: ["dashboard", "usage", "metrics"], message: "Usage metrics must be unique" });
  }
  const assignedStatusGroups = new Map<string, string>();
  const statusGroupNames = ["waiting", "active", "completed", "failed"] as const;
  for (const groupName of statusGroupNames) {
    value.dashboard.taskHealth.statusGroups[groupName].forEach((status, index) => {
      const existingGroup = assignedStatusGroups.get(status);
      if (existingGroup) {
        context.addIssue({
          code: "custom",
          path: ["dashboard", "taskHealth", "statusGroups", groupName, index],
          message: `Task status '${status}' is already assigned to '${existingGroup}'`,
        });
      } else {
        assignedStatusGroups.set(status, groupName);
      }
    });
  }
});

export type ProjectAgentModel = z.infer<typeof projectAgentModelSchema>;
export type ProjectAgentRuntime = z.infer<typeof projectAgentRuntimeSchema>;
export type ProjectAgent = z.infer<typeof projectAgentSchema>;
export type ProjectAgentRelation = z.infer<typeof projectAgentRelationSchema>;
export type ProjectTaskHealthMetric = z.infer<typeof projectTaskHealthMetricSchema>;
export type ProjectUsageMetric = z.infer<typeof projectUsageMetricSchema>;
export type ProjectWorkspaceConfig = z.infer<typeof projectWorkspaceConfigSchema>;

export function createDefaultProjectWorkspaceConfig(input: {
  engineId?: string | null;
  agentName?: string;
  agentRole?: string;
} = {}): ProjectWorkspaceConfig {
  return projectWorkspaceConfigSchema.parse({
    schemaVersion: 1,
    revision: 0,
    goal: "",
    agents: [{
      id: "project-lead",
      name: input.agentName ?? "Project Assistant",
      avatarSeed: "project-lead",
      role: input.agentRole ?? "Coordinate project goals, tasks, and collaboration",
      prompt: "",
      skillIds: [],
      pluginIds: [],
      runtime: {
        engineId: input.engineId?.trim() || null,
        model: null,
        mode: "auto",
        modelVariant: null,
      },
    }],
    orchestration: { entryAgentId: "project-lead", relations: [] },
  });
}
