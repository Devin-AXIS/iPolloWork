import { z } from "zod";

export const taskStatuses = ["todo", "doing", "review", "done"] as const;
export const taskPriorities = ["normal", "high", "urgent"] as const;
const userId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const instant = z.number().int().min(0).max(253402300799999).nullable();
function unique<T>(items: T[]) { return new Set(items).size === items.length; }

export const boardAgentSchema = z.strictObject({
  id: z.union([z.literal("current"), z.uuid()]),
  name: z.string().trim().min(1).max(100),
  ownerId: userId.nullable(),
});
export type BoardAgent = z.infer<typeof boardAgentSchema>;
export const agentKey = (agent: BoardAgent) => JSON.stringify([agent.ownerId, agent.id]);
export function assignmentAgents(task: Pick<TaskDraft, "assigneeAgent" | "participantAgents">) {
  return [...(task.assigneeAgent ? [task.assigneeAgent] : []), ...(task.participantAgents ?? [])];
}

export const taskDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(8000),
  status: z.enum(taskStatuses),
  priority: z.enum(taskPriorities),
  startAt: instant,
  dueAt: instant,
  assigneeId: userId.nullable(),
  assigneeAgent: boardAgentSchema.nullable().optional(),
  participantAgents: z.array(boardAgentSchema).max(20).refine(items => unique(items.map(agentKey))).optional(),
  participantIds: z.array(userId).max(100).refine(unique),
  predecessorIds: z.array(z.uuid()).max(50).refine(unique),
  sessionId: z.string().regex(/^session-[A-Za-z0-9_-]+$/).max(128).nullable(),
}).refine(task => (task.startAt === null || task.dueAt === null || task.startAt <= task.dueAt) &&
  !(task.assigneeId && task.assigneeAgent));
export const taskWriteSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().min(0).max(2147483646),
  task: taskDraftSchema,
});
export const taskStatusSchema = z.strictObject({
  id: z.uuid(), revision: z.number().int().min(1).max(2147483646), status: z.enum(taskStatuses),
});
export type TaskDraft = z.infer<typeof taskDraftSchema>;
export type TaskWrite = z.infer<typeof taskWriteSchema>;
export type TaskStatusWrite = z.infer<typeof taskStatusSchema>;
export type ProjectTask = TaskDraft & { id: string; revision: number; blocked: boolean };
export type BoardNotice = { id: string; projectId: string; projectTitle: string; taskId: string; title: string; kind: "assigned" | "participating" | "ready"; createdAt: number; read: boolean };

export function assignmentPeople(task: Pick<TaskDraft, "assigneeId" | "participantIds">) {
  return new Set([...(task.assigneeId ? [task.assigneeId] : []), ...task.participantIds]);
}
