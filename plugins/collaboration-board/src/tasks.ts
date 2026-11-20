import { z } from 'zod';
import { assignmentAgents, taskDraftSchema, type ProjectTask, type TaskStatusWrite, type TaskWrite } from '../../../services/ipollowork/src/project-board-contract.ts';

export const storedTask = z.object({
  workspace: z.string(),
  value: z.object({ id: z.uuid(), revision: z.number().int().positive(), task: taskDraftSchema }),
});
export type StoredTask = z.infer<typeof storedTask>;

export class BoardFailure extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export interface TaskTable {
  get(key: string): StoredTask | undefined;
  put(key: string, task: StoredTask): Promise<void>;
  entries(): IterableIterator<[string, StoredTask]>;
}
export function localCards(table: TaskTable, workspace: string) {
  return new Map([...table.entries()].filter(([, row]) => row.workspace === workspace).map(([id, row]) => [id, row.value]));
}
export function projectTask(item: StoredTask['value'], cards: ReturnType<typeof localCards>): ProjectTask {
  return { id: item.id, revision: item.revision, ...item.task,
    blocked: item.task.predecessorIds.some(id => cards.get(id)?.task.status !== 'done') };
}
export async function writeLocalTask(table: TaskTable, workspace: string, input: TaskWrite | TaskStatusWrite) {
  const cards = localCards(table, workspace);
  const previous = cards.get(input.id);
  if ((previous?.revision ?? 0) !== input.revision) throw new BoardFailure('BOARD_CONFLICT',409);
  if (!previous && !('task' in input)) throw new BoardFailure('BOARD_TASK_NOT_FOUND',404);
  if (!previous && table.get(input.id)) throw new BoardFailure('BOARD_CONFLICT',409);
  const task = 'task' in input ? input.task : { ...previous!.task, status: input.status };
  if (assignmentAgents(task).some(agent => agent.ownerId !== null)) throw new BoardFailure('BOARD_AGENT_UNAVAILABLE',403);
  if (task.assigneeId || task.participantIds.length) throw new BoardFailure('BOARD_ASSIGNEE_UNAVAILABLE',403);
  if (task.sessionId && [...cards.values()].some(item=>item.id!==input.id && item.task.sessionId===task.sessionId))
    throw new BoardFailure('BOARD_CONFLICT',409);
  const queue = [...task.predecessorIds];
  const seen = new Set<string>();
  for (const id of queue) {
    if (id === input.id) throw new BoardFailure('BOARD_DEPENDENCY_CYCLE',409);
    if (seen.has(id)) continue;
    seen.add(id);
    const predecessor = cards.get(id);
    if (!predecessor) throw new BoardFailure('BOARD_PREDECESSOR_NOT_FOUND',404);
    queue.push(...predecessor.task.predecessorIds);
  }
  const value = { id: input.id, revision: input.revision + 1, task };
  if (task.status !== 'todo' && projectTask(value,cards).blocked) throw new BoardFailure('BOARD_TASK_BLOCKED',409);
  if (previous?.task.status==='done' && task.status!=='done' &&
      [...cards.values()].some(item=>item.task.status!=='todo' && item.task.predecessorIds.includes(input.id)))
    throw new BoardFailure('BOARD_DEPENDENT_STARTED',409);
  await table.put(input.id,{workspace,value});
  cards.set(input.id,value);
  return projectTask(value,cards);
}
