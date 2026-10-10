import { z } from "zod";
import { DEFAULT_ENGINE_ID } from "./workspace.js";

import {
  projectAgentModelSchema,
  projectAgentSchema,
  projectWorkspaceConfigSchema,
} from "./project-workspace.js";

export const WORK_ITEM_TITLE_MAX_LENGTH = 80;

export const workItemPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type WorkItemPriority = z.infer<typeof workItemPrioritySchema>;

export const workItemAutomationRecurrenceSchema = z.enum(["once", "daily", "weekly"]);

export const workItemAutomationSchema = z.object({
  enabled: z.boolean(),
  recurrence: workItemAutomationRecurrenceSchema,
  model: projectAgentModelSchema.nullable().optional(),
});

export type WorkItemAutomation = z.infer<typeof workItemAutomationSchema>;
export type WorkItemAutomationRecurrence = z.infer<typeof workItemAutomationRecurrenceSchema>;

export const workItemCustomValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const workItemCustomFieldsSchema = z.record(
  z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/),
  workItemCustomValueSchema,
).refine((value) => Object.keys(value).length <= 24, {
  message: "A work item can contain at most 24 custom fields",
});

export const workItemCreateSchema = z.object({
  title: z.string().trim().min(1).max(WORK_ITEM_TITLE_MAX_LENGTH),
  description: z.string().trim().max(4_000).nullable().optional(),
  status: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/).default("planned"),
  assignee: z.string().trim().max(120).nullable().optional(),
  priority: workItemPrioritySchema.default("normal"),
  startAt: z.number().int().nonnegative().nullable().optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(),
  automation: workItemAutomationSchema.nullable().default(null),
  position: z.number().finite().optional(),
  customFields: workItemCustomFieldsSchema.default({}),
}).superRefine((value, context) => {
  if (value.startAt !== null && value.startAt !== undefined && value.dueAt !== null && value.dueAt !== undefined && value.dueAt < value.startAt) {
    context.addIssue({ code: "custom", path: ["dueAt"], message: "Due time cannot be earlier than start time" });
  }
  if (value.automation?.enabled && (value.startAt === null || value.startAt === undefined)) {
    context.addIssue({ code: "custom", path: ["automation"], message: "Automatic execution requires a start time" });
  }
});

export type WorkItemCreateInput = z.input<typeof workItemCreateSchema>;

export const workItemUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(WORK_ITEM_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
  status: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  assignee: z.string().trim().max(120).nullable().optional(),
  priority: workItemPrioritySchema.optional(),
  startAt: z.number().int().nonnegative().nullable().optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(),
  automation: workItemAutomationSchema.nullable().optional(),
  position: z.number().finite().optional(),
  customFields: workItemCustomFieldsSchema.optional(),
});

export type WorkItemUpdateInput = z.infer<typeof workItemUpdateSchema>;

export const projectSessionExecutionRuntimeSchema = z.object({
  engineId: z.string().trim().min(1).max(80),
  model: projectAgentModelSchema.nullable(),
  mode: z.string().trim().min(1).max(80).nullable(),
  modelVariant: z.string().trim().min(1).max(64).nullable(),
});

export const conversationWorkKindSchema = z.enum(["general", "video", "design", "development", "research", "document"]);
export const conversationWorkflowStageSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1).max(80),
  instructions: z.string().trim().max(4_000).default(""),
  agentId: z.string().trim().min(1).max(64).optional(),
  acceptance: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
});
const workflowContent = {
  workKind: conversationWorkKindSchema,
  config: projectWorkspaceConfigSchema,
  stages: z.array(conversationWorkflowStageSchema).max(16),
  acceptance: z.array(z.string().trim().min(1).max(500)).max(16),
};
function validateWorkflowStages(value: { config: z.infer<typeof projectWorkspaceConfigSchema>; stages: z.infer<typeof conversationWorkflowStageSchema>[] }, context: z.RefinementCtx) {
  if (new Set(value.stages.map((stage) => stage.id)).size !== value.stages.length) {
    context.addIssue({ code: "custom", path: ["stages"], message: "Stage IDs must be unique" });
  }
  value.stages.forEach((stage, index) => {
    if (stage.agentId && !value.config.agents.some((agent) => agent.id === stage.agentId)) {
      context.addIssue({ code: "custom", path: ["stages", index, "agentId"], message: "Stage Agent must reference the conversation team" });
    }
  });
}
export const workTemplateSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  origin: z.enum(["builtin", "saved"]),
  ...workflowContent,
}).superRefine(validateWorkflowStages);
export const conversationWorkflowSchema = z.object({
  templateId: workTemplateSchema.shape.id,
  templateVersion: z.number().int().positive(),
  templateName: workTemplateSchema.shape.name,
  source: z.enum(["manual", "auto", "custom"]),
  goal: z.string().trim().max(2_000),
  ...workflowContent,
  progress: z.object({
    summary: z.string().trim().max(2_000),
    decisions: z.array(z.string().trim().min(1).max(500)).max(20),
    outputs: z.array(z.string().trim().min(1).max(1_000)).max(32),
    blockers: z.array(z.string().trim().min(1).max(500)).max(12),
  }).optional(),
  updatedAt: z.number().int().nonnegative(),
}).superRefine(validateWorkflowStages);
export const conversationWorkflowUpdateSchema = z.object({
  title: z.string().trim().min(1).max(WORK_ITEM_TITLE_MAX_LENGTH).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  runtime: projectSessionExecutionRuntimeSchema,
  templateId: workTemplateSchema.shape.id.optional(),
  source: conversationWorkflowSchema.shape.source.default("manual"),
  goal: conversationWorkflowSchema.shape.goal.optional(),
  workKind: conversationWorkKindSchema.optional(),
  config: projectWorkspaceConfigSchema.optional(),
  stages: conversationWorkflowSchema.shape.stages.optional(),
  acceptance: conversationWorkflowSchema.shape.acceptance.optional(),
  progress: conversationWorkflowSchema.shape.progress.unwrap().partial().optional(),
});
export const workTemplateSaveSchema = z.object({
  sessionId: z.string().trim().min(1).max(240),
  templateId: workTemplateSchema.shape.id.optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  name: workTemplateSchema.shape.name,
  description: workTemplateSchema.shape.description.optional(),
});
export type ConversationWorkKind = z.infer<typeof conversationWorkKindSchema>;
export type ConversationWorkflowStage = z.infer<typeof conversationWorkflowStageSchema>;
export type ConversationWorkflow = z.infer<typeof conversationWorkflowSchema>;
export type ConversationWorkflowUpdateInput = z.input<typeof conversationWorkflowUpdateSchema>;
export type WorkTemplate = z.infer<typeof workTemplateSchema>;
export type WorkTemplateSaveInput = z.infer<typeof workTemplateSaveSchema>;
export type WorkTemplateStats = {
  byTemplate: Array<{ templateId: string; runs: number; reviewedCompletions: number }>;
  byWorkKind: Array<{ workKind: ConversationWorkKind; runs: number; reviewedCompletions: number }>;
};
export type WorkTemplateListResponse = { templates: WorkTemplate[]; stats: WorkTemplateStats };
export type ConversationWorkflowResponse = { item: WorkItem | null };

export const projectSessionExecutionSchema = z.object({
  sessionId: z.string().trim().min(1).max(240),
  projectRevision: z.number().int().nonnegative(),
  projectGoal: z.string().trim().max(2_000),
  agent: projectAgentSchema,
  runtime: projectSessionExecutionRuntimeSchema,
  boundAt: z.number().int().nonnegative(),
  workflow: conversationWorkflowSchema.optional(),
});

const sessionWorkItemTitleSchema = z.string().trim().min(1).max(500)
  .transform((title) => title.slice(0, WORK_ITEM_TITLE_MAX_LENGTH));

export const projectSessionExecutionStartSchema = z.object({
  title: sessionWorkItemTitleSchema,
  agentId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  runtime: projectSessionExecutionRuntimeSchema,
  goal: conversationWorkflowSchema.shape.goal.optional(),
  workKind: conversationWorkKindSchema.optional(),
});

export const projectSessionExecutionFinishSchema = z.object({
  status: z.enum(["done", "failed"]),
  title: sessionWorkItemTitleSchema.optional(),
  error: z.string().trim().max(2_000).nullable().optional(),
});

export type ProjectSessionExecution = z.infer<typeof projectSessionExecutionSchema>;
export type ProjectSessionExecutionRuntime = z.infer<typeof projectSessionExecutionRuntimeSchema>;
export type ProjectSessionExecutionStartInput = z.infer<typeof projectSessionExecutionStartSchema>;
export type ProjectSessionExecutionFinishInput = z.infer<typeof projectSessionExecutionFinishSchema>;

/** Namespaced native roles never replace engine built-ins such as plan or explore. */
export function nativeWorkAgentType(templateId: string, agentId: string): string {
  return `ipw-${templateId}.${agentId}`;
}

export function projectExecutionSystemContext(execution: ProjectSessionExecution): string {
  const workflow = execution.workflow;
  const examples = workflow?.source !== "auto" ? workflow?.config.agents.filter((agent) => agent.id !== execution.agent.id).map((agent) => [
    `${workflow.source === "custom" ? `[project-agent:${agent.id}]` : nativeWorkAgentType(workflow.templateId, agent.id)}: ${agent.name}${agent.role ? ` — ${agent.role}` : ""}`,
    // A customized conversation remains task guidance, without overwriting a
    // reusable native role shared with another conversation.
    workflow.source === "custom" ? agent.prompt : null,
    workflow.source === "custom" && agent.skillIds.length ? `Skills: ${agent.skillIds.map((id) => id.split(":").at(-1)).join(", ")}` : null,
  ].filter(Boolean).join("\n")).join("\n\n") : undefined;
  return [
    `You are ${execution.agent.name}.`,
    execution.projectGoal ? `Project goal: ${execution.projectGoal}` : null,
    workflow ? `Task goal: ${workflow.goal || "Follow the current user request."}` : null,
    "Use your engine's native plan, tools, subagents and result collection; choose the actual workflow yourself. iPolloWork displays native execution and files; it does not run a second agent workflow after your turn.",
    execution.agent.prompt || execution.agent.role,
    examples ? `Available preset roles (optional):\n${examples}` : null,
    examples ? workflow?.source === "custom"
      ? "If a preset helps, use a built-in native worker and pass its current instructions, Skills and role label with the task inputs. These are conversation-specific definitions, not registered agent types; do not substitute shared named preset types for these edited roles. You may use other workers or complete the task yourself."
      : "If a preset helps, choose its native agent type above. Its role prompt and Skills are already configured. You may also use built-in workers or complete the task yourself." : null,
    workflow?.source !== "auto" && workflow?.stages.length ? `Suggested steps: ${workflow.stages.map((stage) => stage.title).join(" → ")}` : null,
    workflow?.acceptance.length ? `Requested result: ${workflow.acceptance.join("; ")}` : null,
    execution.agent.pluginIds.length ? `Assigned plugins: ${execution.agent.pluginIds.join(", ")}` : null,
    execution.agent.skillIds.length ? `Assigned skills: ${execution.agent.skillIds.join(", ")}` : null,
    "Proactively use native subagents when bounded parallel work or an independent review materially saves time or improves quality. Keep simple tasks on the main agent when delegation adds no value. Delegate with exact inputs, owned paths and the expected result. Parallelize independent tasks; sequence dependent steps after their required inputs are available, and avoid concurrent edits to the same files. Collect native worker results, check source evidence and conflicting claims, then integrate actual paths, evidence and unfinished work into the main answer. Unobserved checks remain unverified. Role labels such as [project-agent:ROLE_ID] are optional display hints, not execution requirements.",
  ].filter((value): value is string => Boolean(value?.trim())).join("\n\n");
}

export type WorkItem = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: string;
  assignee: string | null;
  priority: WorkItemPriority;
  startAt: number | null;
  dueAt: number | null;
  automation: WorkItemAutomation | null;
  automationLastRunAt: number | null;
  automationLastSessionId: string | null;
  automationLastError: string | null;
  position: number;
  customFields: Record<string, string | number | boolean | null>;
  execution: ProjectSessionExecution | null;
  lastError: string | null;
  runStartedAt: number | null;
  runCompletedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type WorkItemListResponse = {
  items: WorkItem[];
  nextCursor: string | null;
};

export const workBoardColumnToneSchema = z.enum([
  "neutral",
  "blue",
  "amber",
  "violet",
  "green",
  "rose",
]);

export const workBoardColumnSchema = z.object({
  id: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(48),
  tone: workBoardColumnToneSchema.default("neutral"),
});

export const workBoardFieldSchema = z.object({
  id: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(48),
  type: z.enum(["text", "number", "select", "date", "checkbox"]),
  options: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  showOnCard: z.boolean().default(true),
});

export const workBoardConfigValueSchema = z.object({
  columns: z.array(workBoardColumnSchema).min(1).max(8),
  fields: z.array(workBoardFieldSchema).max(12),
}).superRefine((value, context) => {
  const columnIds = value.columns.map((column) => column.id);
  if (new Set(columnIds).size !== columnIds.length) {
    context.addIssue({ code: "custom", path: ["columns"], message: "Board column IDs must be unique" });
  }
  const fieldIds = value.fields.map((field) => field.id);
  if (new Set(fieldIds).size !== fieldIds.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Board field IDs must be unique" });
  }
});

export type WorkBoardColumn = z.infer<typeof workBoardColumnSchema>;
export type WorkBoardField = z.infer<typeof workBoardFieldSchema>;
export type WorkBoardConfigValue = z.infer<typeof workBoardConfigValueSchema>;

export type WorkBoardConfig = WorkBoardConfigValue & {
  workspaceId: string;
  version: number;
  updatedAt: number | null;
};

export const DEFAULT_WORK_BOARD_COLUMNS: WorkBoardColumn[] = [
  { id: "planned", label: "待规划", tone: "neutral" },
  { id: "ready", label: "待执行", tone: "blue" },
  { id: "running", label: "执行中", tone: "amber" },
  { id: "review", label: "待验收", tone: "violet" },
  { id: "done", label: "已完成", tone: "green" },
  { id: "failed", label: "失败", tone: "rose" },
];

export const DEFAULT_WORK_BOARD_CONFIG: WorkBoardConfigValue = {
  columns: DEFAULT_WORK_BOARD_COLUMNS,
  fields: [],
};
