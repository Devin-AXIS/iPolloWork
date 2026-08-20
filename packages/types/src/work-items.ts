import { z } from "zod";

import {
  projectAgentModelSchema,
  projectAgentSchema,
} from "./project-workspace.js";

export const workItemPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type WorkItemPriority = z.infer<typeof workItemPrioritySchema>;

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
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).nullable().optional(),
  status: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/).default("planned"),
  assignee: z.string().trim().max(120).nullable().optional(),
  priority: workItemPrioritySchema.default("normal"),
  startAt: z.number().int().nonnegative().nullable().optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(),
  position: z.number().finite().optional(),
  customFields: workItemCustomFieldsSchema.default({}),
}).superRefine((value, context) => {
  if (value.startAt !== null && value.startAt !== undefined && value.dueAt !== null && value.dueAt !== undefined && value.dueAt < value.startAt) {
    context.addIssue({ code: "custom", path: ["dueAt"], message: "Due time cannot be earlier than start time" });
  }
});

export type WorkItemCreateInput = z.input<typeof workItemCreateSchema>;

export const workItemUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
  status: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  assignee: z.string().trim().max(120).nullable().optional(),
  priority: workItemPrioritySchema.optional(),
  startAt: z.number().int().nonnegative().nullable().optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(),
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

export const projectSessionExecutionSchema = z.object({
  sessionId: z.string().trim().min(1).max(240),
  projectRevision: z.number().int().nonnegative(),
  projectGoal: z.string().trim().max(2_000),
  agent: projectAgentSchema,
  runtime: projectSessionExecutionRuntimeSchema,
  boundAt: z.number().int().nonnegative(),
});

export const projectSessionExecutionStartSchema = z.object({
  title: z.string().trim().min(1).max(160),
  agentId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  runtime: projectSessionExecutionRuntimeSchema,
});

export const projectSessionExecutionFinishSchema = z.object({
  status: z.enum(["done", "failed"]),
  title: z.string().trim().min(1).max(160).optional(),
  error: z.string().trim().max(2_000).nullable().optional(),
});

export type ProjectSessionExecution = z.infer<typeof projectSessionExecutionSchema>;
export type ProjectSessionExecutionRuntime = z.infer<typeof projectSessionExecutionRuntimeSchema>;
export type ProjectSessionExecutionStartInput = z.infer<typeof projectSessionExecutionStartSchema>;
export type ProjectSessionExecutionFinishInput = z.infer<typeof projectSessionExecutionFinishSchema>;

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
