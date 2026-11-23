import { z } from 'zod';
import { assignmentAgents, taskDraftSchema, type ProjectTask, type TaskStatusWrite, type TaskWrite, type TaskActionWrite, type TaskListQuery, type TaskPage } from '../../../services/ipollowork/src/project-board-contract.ts';

export const storedTask = z.object({
  workspace: z.string(),
  value: z.object({ id: z.uuid(), revision: z.number().int().positive(), task: taskDraftSchema,archived:z.boolean().optional(),deletedAt:z.number().nullable().optional() }),
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
    ...(item.archived!==undefined?{archived:item.archived}:{}),...(item.deletedAt!==undefined?{deletedAt:item.deletedAt}:{}),
    blocked: item.task.predecessorIds.some(id => !cards.get(id)||cards.get(id)?.deletedAt!=null||cards.get(id)?.task.status !== 'done') };
}
export function listLocalTasks(table:TaskTable,workspace:string,query:TaskListQuery,after=''):TaskPage {
  const cards=localCards(table,workspace),filter=query.query.trim().toLocaleLowerCase();
  const matches=[...cards.values()].filter(item=>query.scope==='trash'?item.deletedAt!=null:item.deletedAt==null&&Boolean(item.archived)===(query.scope==='archived'))
    .filter(item=>[item.task.title,item.task.description,item.task.assigneeAgent?.name].some(value=>value?.toLocaleLowerCase().includes(filter)));
  const sorted=matches.filter(item=>item.id>after).sort((a,b)=>a.id>b.id?1:a.id<b.id?-1:0).slice(0,101);
  return {tasks:sorted.slice(0,100).map(item=>projectTask(item,cards)),next:sorted.length>100?sorted[99]!.id:null,
    totals:{total:matches.length,done:matches.filter(item=>item.task.status==='done').length},version:2,
    linkedSessionIds:[...cards.values()].flatMap(item=>item.task.sessionId?[item.task.sessionId]:[])};
}
export async function actLocalTask(table:TaskTable,workspace:string,input:TaskActionWrite) {
  const cards=localCards(table,workspace),previous=cards.get(input.id);
  if(!previous)throw new BoardFailure('BOARD_TASK_NOT_FOUND',404);
  if(previous.revision!==input.revision)throw new BoardFailure('BOARD_CONFLICT',409);
  if(previous.deletedAt!=null&&input.action!=='restore')throw new BoardFailure('BOARD_TASK_NOT_FOUND',404);
  if(input.action==='delete'&&[...cards.values()].some(item=>item.deletedAt==null&&item.task.predecessorIds.includes(input.id)))
    throw new BoardFailure('BOARD_DEPENDENCY_IN_USE',409);
  if(input.action==='restore'){
    if(previous.task.predecessorIds.some(id=>!cards.has(id)||cards.get(id)!.deletedAt!=null))throw new BoardFailure('BOARD_PREDECESSOR_NOT_FOUND',404);
    if(previous.task.sessionId&&[...cards.values()].some(item=>item.id!==input.id&&item.deletedAt==null&&item.task.sessionId===previous.task.sessionId))throw new BoardFailure('BOARD_CONFLICT',409);
  }
  const next={...previous,revision:previous.revision+1,
    archived:input.action==='archive'?true:input.action==='unarchive'?false:previous.archived??false,
    deletedAt:input.action==='delete'?Date.now():input.action==='restore'?null:previous.deletedAt??null,
    task:input.action==='restore'&&projectTask(previous,cards).blocked?{...previous.task,status:'todo' as const}:previous.task};
  await table.put(input.id,{workspace,value:next});return projectTask(next,cards);
}
export async function writeLocalTask(table: TaskTable, workspace: string, input: TaskWrite | TaskStatusWrite) {
  const cards = localCards(table, workspace);
  const previous = cards.get(input.id);
  if(previous?.deletedAt!=null)throw new BoardFailure('BOARD_TASK_NOT_FOUND',404);
  if ((previous?.revision ?? 0) !== input.revision) throw new BoardFailure('BOARD_CONFLICT',409);
  if (!previous && !('task' in input)) throw new BoardFailure('BOARD_TASK_NOT_FOUND',404);
  if (!previous && table.get(input.id)) throw new BoardFailure('BOARD_CONFLICT',409);
  const task = 'task' in input ? input.task : { ...previous!.task, status: input.status };
  if (assignmentAgents(task).some(agent => agent.ownerId !== null)) throw new BoardFailure('BOARD_AGENT_UNAVAILABLE',403);
  if (task.assigneeId || task.participantIds.length) throw new BoardFailure('BOARD_ASSIGNEE_UNAVAILABLE',403);
  if (task.sessionId && [...cards.values()].some(item=>item.id!==input.id && item.deletedAt==null && item.task.sessionId===task.sessionId))
    throw new BoardFailure('BOARD_CONFLICT',409);
  const queue = [...task.predecessorIds];
  const seen = new Set<string>();
  for (const id of queue) {
    if (id === input.id) throw new BoardFailure('BOARD_DEPENDENCY_CYCLE',409);
    if (seen.has(id)) continue;
    seen.add(id);
    const predecessor = cards.get(id);
    if (!predecessor || predecessor.deletedAt!=null) throw new BoardFailure('BOARD_PREDECESSOR_NOT_FOUND',404);
    queue.push(...predecessor.task.predecessorIds);
  }
  const value = { ...previous,id: input.id, revision: input.revision + 1, task };
  if (task.status !== 'todo' && projectTask(value,cards).blocked) throw new BoardFailure('BOARD_TASK_BLOCKED',409);
  if (previous?.task.status==='done' && task.status!=='done' &&
      [...cards.values()].some(item=>item.deletedAt==null && item.task.status!=='todo' && item.task.predecessorIds.includes(input.id)))
    throw new BoardFailure('BOARD_DEPENDENT_STARTED',409);
  await table.put(input.id,{workspace,value});
  cards.set(input.id,value);
  return projectTask(value,cards);
}
