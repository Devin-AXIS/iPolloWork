import { randomUUID } from 'node:crypto';
import type { ScheduleService } from '@deepseek-ai/dsh-schedule';
import { z } from 'zod';
import { agentKey, assignmentAgents, type ProjectTask } from '../../../services/ipollowork/src/project-board-contract.ts';

export const scheduledStart = z.object({
  sessionId: z.string(),
  token: z.uuid(),
  signature: z.string(),
  account: z.string().nullable(),
  scheduleId: z.string().nullable(),
});
type ScheduledStart = z.infer<typeof scheduledStart>;
export interface ScheduleTable {
  get(key: string): ScheduledStart | undefined;
  put(key: string, value: ScheduledStart): Promise<void>;
  delete(key: string): Promise<void>;
}
export type NativeSchedule = Pick<ScheduleService, 'create' | 'view' | 'edit'>;
type ScheduleId = Parameters<NativeSchedule['view']>[0]['id'];
type SessionId = Extract<NonNullable<Parameters<NativeSchedule['create']>[0]['target']>, { kind: 'session' }>['sessionId'];

export const scheduleKey = (workspaceId: string, taskId: string) => workspaceId + '/' + taskId;
export const scheduleSignature = (task: ProjectTask) => JSON.stringify([
  task.startAt, task.sessionId, assignmentAgents(task).map(agentKey),
]);

function instruction(id: string, token: string) {
  return `The project board owner authorized one automatic start. First call ipollo_project_tasks with action "scheduled_start", taskId "${id}" and token "${token}". Do not act on the task unless that call returns started: true. Use the returned task title and description. For ai.delegates use ipollo_delegate with the listed agent_preset values. For ai.external use the exact listed tools in the project working directory. If both lists are empty, do the task in this conversation. Wait for real results, report failures, and summarize the work in the conversation's language. Mark the task complete using its latest revision only after verifying the work is done.`;
}

async function ownedSchedule(service: NativeSchedule, link: ScheduledStart) {
  if (!link.scheduleId) return undefined;
  const entry = await service.view({ id: link.scheduleId as ScheduleId });
  return 'code' in entry || !entry.prompt.includes(link.token) ? undefined : entry;
}

export async function canStartScheduledTask(service: NativeSchedule | undefined, link: ScheduledStart) {
  const entry = service && await ownedSchedule(service, link);
  return Boolean(entry && entry.status !== 'paused' && entry.target.kind === 'session' &&
    entry.target.sessionId === link.sessionId && Date.parse(entry.scheduledAt) <= Date.now());
}

export async function syncSchedule(table: ScheduleTable, service: NativeSchedule | undefined, key: string,
  task: ProjectTask, target: { sessionId: string; account: string | null; startAt: number } | undefined, signal: AbortSignal) {
  const previous = table.get(key);
  if (!previous && !target) return;
  const signature = scheduleSignature(task);
  const existing = previous && service ? await ownedSchedule(service, previous) : undefined;
  if (previous && target && existing?.status === 'active' && previous.signature === signature &&
      previous.sessionId === target.sessionId && previous.account === target.account &&
      existing.target.kind === 'session' && existing.target.sessionId === target.sessionId &&
      Date.parse(existing.scheduledAt) === target.startAt) return;
  if (!service) throw new Error('BOARD_SCHEDULE_UNAVAILABLE');
  if (previous) {
    if (existing && existing.status !== 'ended') {
      const edited = await service.edit({
        id: existing.id, action: 'delete', expectedUpdatedAt: existing.updatedAt ?? null,
      }, previous.sessionId as SessionId, signal);
      if ('code' in edited && edited.code !== 'schedule_not_found') throw new Error('BOARD_SCHEDULE_CONFLICT');
    }
    await table.delete(key);
  }
  if (!target) return;

  // Store the guard before arming. If a save takes until the agreed time, deliver just after it commits.
  const link: ScheduledStart = {
    token: randomUUID(), sessionId: target.sessionId, account: target.account, signature, scheduleId: null,
  };
  await table.put(key, link);
  const sessionId = target.sessionId as SessionId;
  const entry = await service.create({
    title: Array.from(task.title).slice(0, 60).join(''),
    prompt: instruction(task.id, link.token),
    timing: target.startAt > Date.now()
      ? { kind: 'at', at: new Date(target.startAt).toISOString() }
      : { kind: 'after', after_seconds: 1 },
    target: { kind: 'session', sessionId },
  }, sessionId, signal);
  await table.put(key, { ...link, scheduleId: entry.id });
}
