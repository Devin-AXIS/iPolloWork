import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { defineTool, type ToolDefinition, type ToolRunContext, type ToolsService } from '@deepseek-ai/dsh-tools';
import { agentKey, assignmentAgents, taskStatusSchema, taskWriteSchema, type ProjectTask, type TaskWrite, type TaskStatusWrite } from '../../../services/ipollowork/src/project-board-contract.ts';
import type { ProjectBoardGateway, ProjectRoster, ProjectRosterSource } from '../../ipollowork-suite/src/shared/enterprise.ts';
import { BoardFailure, localCards, projectTask, storedTask, writeLocalTask, type TaskTable } from './tasks.ts';
import { currentAgent, statuses, type AgentChoice, type AgentPlan, type BoardNote } from './model.ts';
import { canStartScheduledTask, scheduledStart, scheduleKey, scheduleSignature, syncSchedule, type NativeSchedule, type ScheduleTable } from './schedule.ts';

export const name = 'ipollo-collaboration-board';
export const inject = ['webServer', 'connection', 'connection.authentication', 'workspaceRegistry', 'storageDomain'];
const path = '/ipollo-project-board';

interface Table {
  get(key: string): BoardNote | undefined;
  put(key: string, note: BoardNote): Promise<void>;
}
type Agent = NonNullable<ToolRunContext['agent']>;
type ToolSession = Agent['session'];
type NativeTools = { tools: { register(tool: ToolDefinition): () => void };
  sandboxPolicy: { resolve(input: { session: ToolSession }): { mode: string } } };
type NativeAgents = { subagents: {
  rootOf(agent: Agent): Agent;
  getProvider(name: string): { start?: unknown } | undefined;
}; tools: Pick<ToolsService, 'executable'> };
// Stable UUIDs let existing task records and account services store these native assignments.
const nativeDelegates = [
  { provider: 'codex', id: 'd4df01af-bf21-56ad-a057-078d060a2bca', name: 'Codex', preset: null, nativeTool: 'subagent_codex' },
  { provider: 'claude-code', id: '22001431-03e9-5f97-94f2-68a0744d9c2b', name: 'Claude Code', preset: null, nativeTool: 'subagent_claude_code' },
] as const satisfies readonly (AgentChoice & { provider: string })[];
interface Host {
  inject(names: ['tools', 'sandboxPolicy'], install: (scope: Host & NativeTools) => void): void;
  inject(names: ['ipolloAgents'], install: (scope: Host & { ipolloAgents: { boardAgents?(): Promise<AgentChoice[]> } }) => void): void;
  inject(names: ['subagents', 'tools'], install: (scope: Host & NativeAgents) => void): void;
  inject(names: ['ipolloProjectBoard'], install: (scope: Host & { ipolloProjectBoard: ProjectBoardGateway }) => void): void;
  inject(names: ['ipolloProjectRoster'], install: (scope: Host & { ipolloProjectRoster: ProjectRosterSource }) => void): void;
  inject(names: ['schedule'], install: (scope: Host & { schedule: NativeSchedule }) => void): void;
  effect(install: () => void | (() => void | Promise<void>)): void;
  storageDomain: {
    open(spec: typeof storage): Promise<{ table(name: 'notes'): Table; table(name:'tasks'): TaskTable; close(): Promise<void> }>;
    open(spec: typeof scheduleStorage): Promise<{ table(name: 'starts'): ScheduleTable; close(): Promise<void> }>;
  };
  connection: {
    admit(request: IncomingMessage): { rejection: number } | { peer: { principal: { kind: string } } };
  };
  workspaceRegistry: {
    get(id: string): { sessionIds: readonly string[] } | undefined;
    list(): readonly { id: string; path: string; sessionIds: readonly string[] }[];
    archivedSessionIds: readonly string[];
  };
  webServer: {
    register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }): () => void;
  };
}
const date = z.iso.date().refine(value => value >= '0001-01-01').nullable();
const fields = { status: z.enum(statuses).nullable(), startOn: date, dueOn: date };
const revision = z.number().int().nonnegative();
const scopeId = z.string().regex(/^[a-f0-9]{64}$/);
const personId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const note = z.object({ ...fields, revision, assignee: z.object({ scope: scopeId, userId: personId }).optional() });
const storage = { name: 'ipollo_project_board', version: 2, compatibleVersions: [1], tables: { notes: { valueSchema: note }, tasks: { valueSchema: storedTask } } } as const;
const scheduleStorage = { name: 'ipollo_project_board_schedule', version: 1, tables: { starts: { valueSchema: scheduledStart } } } as const;
const id = z.string().min(1).max(128);
const change = z.strictObject({
  sessionId: id, revision, status: fields.status.optional(), startOn: date.optional(), dueOn: date.optional(),
  assignment: z.strictObject({ scope: scopeId, userId: personId.nullable() }).optional(),
}).refine(value => value.status !== undefined || value.startOn !== undefined || value.dueOn !== undefined || value.assignment !== undefined);

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > 65536) return undefined;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function apply(ctx: Host): Promise<void> {
  const domain = await ctx.storageDomain.open(storage);
  const scheduleDomain = await ctx.storageDomain.open(scheduleStorage).catch(async (error: unknown) => {
    await domain.close();
    throw error;
  });
  const tasks = domain.table('tasks');
  const starts = scheduleDomain.table('starts');
  let schedule: NativeSchedule | undefined;
  ctx.inject(['schedule'], scope => scope.effect(() => {
    schedule = scope.schedule;
    return () => { schedule = undefined; };
  }));
  let gateway: ProjectBoardGateway | undefined;
  ctx.inject(['ipolloProjectBoard'], scope => scope.effect(() => {
    gateway = scope.ipolloProjectBoard;
    return () => { gateway = undefined; };
  }));
  let listSpecialists: (() => Promise<AgentChoice[]>) | undefined;
  ctx.inject(['ipolloAgents'], scope => scope.effect(() => {
    listSpecialists = () => scope.ipolloAgents.boardAgents?.() ?? Promise.resolve([]);
    return () => { listSpecialists = undefined; };
  }));
  let nativeRoot: ((agent: Agent) => Agent) | undefined;
  let listNative: ((agent?: Agent) => AgentChoice[]) | undefined;
  ctx.inject(['subagents', 'tools'], scope => scope.effect(() => {
    nativeRoot = agent => scope.subagents.rootOf(agent);
    listNative = agent => nativeDelegates.flatMap(({ provider, ...choice }) =>
      typeof scope.subagents.getProvider(provider)?.start === 'function' &&
      scope.tools.executable(choice.nativeTool, agent) ? [choice] : []);
    return () => { nativeRoot = undefined; listNative = undefined; };
  }));
  async function agentChoices(agent?: Agent) {
    const specialists = await listSpecialists?.() ?? [];
    return [currentAgent, ...(listNative?.(agent) ?? []), ...specialists];
  }
  const notes = domain.table('notes');
  const lifetime = new AbortController();
  let rosterSource: ProjectRosterSource | undefined;
  ctx.inject(['ipolloProjectRoster'], scope => scope.effect(() => {
    rosterSource = scope.ipolloProjectRoster;
    return () => { rosterSource = undefined; };
  }));
  let pending: Promise<void> = Promise.resolve();
  let pendingStarts: Promise<void> = Promise.resolve();
  function writeWithSchedule<T>(write: () => Promise<T>) {
    const operation = pendingStarts.then(write);
    pendingStarts = operation.then(() => {}, () => {});
    return operation;
  }
  ctx.effect(() => async () => {
    lifetime.abort();
    await pendingStarts;
    await pending;
    await Promise.all([domain.close(), scheduleDomain.close()]);
  });
  type Page = { tasks: ProjectTask[]; next: string | null };
  async function readTask(workspaceId: string, taskId: string, signal: AbortSignal): Promise<{ task: ProjectTask; remote: boolean }> {
    const remote = await gateway?.({ operation: 'get', workspaceId, taskId }, signal);
    if (remote) return { ...remote as { task: ProjectTask }, remote: true };
    const cards = localCards(tasks, workspaceId);
    const item = cards.get(taskId);
    if (!item) throw new BoardFailure('BOARD_TASK_NOT_FOUND', 404);
    return { task: projectTask(item, cards), remote: false };
  }
  async function listTasks(workspaceId: string, after: string | undefined, signal: AbortSignal): Promise<Page & { remote: boolean }> {
    const remote = await gateway?.({ operation: 'list', workspaceId, ...(after ? { after } : {}) }, signal);
    if (remote) return { ...remote as Page, remote: true };
    const cards = localCards(tasks, workspaceId);
    const ids = [...cards.keys()].sort().filter(id => id > (after ?? '')).slice(0, 101);
    return {
      tasks: ids.slice(0, 100).map(id => projectTask(cards.get(id)!, cards)),
      next: ids.length > 100 ? ids[99]! : null,
      remote: false,
    };
  }
  async function plan(workspaceId: string, task: ProjectTask, signal: AbortSignal, caller?: Agent): Promise<AgentPlan> {
    const refs = assignmentAgents(task);
    if (!refs.length) return { delegates: [], external: [], unavailable: false, humanLead: task.assigneeId !== null };
    const viewerId = refs.some(agent => agent.ownerId !== null)
      ? (await rosterSource?.(workspaceId, signal))?.viewerId ?? null : null;
    const choices = new Map((await agentChoices(caller)).map(choice => [choice.id, choice]));
    const selected = [...new Map(refs.map(agent => [agentKey(agent), agent])).values()];
    const delegates: AgentPlan['delegates'] = [];
    const external: AgentPlan['external'] = [];
    let unavailable = false;
    for (const agent of selected) {
      const choice = agent.ownerId === viewerId ? choices.get(agent.id) : undefined;
      if (!choice) unavailable = true;
      else if (choice.nativeTool) external.push({ name: choice.name, tool: choice.nativeTool });
      else if (choice.preset) delegates.push({ name: choice.name, preset: choice.preset });
    }
    return { delegates, external, unavailable, humanLead: task.assigneeId !== null };
  }
  async function validateAssignments(workspaceId: string, input: TaskWrite, signal: AbortSignal) {
    const refs = assignmentAgents(input.task);
    if (!refs.length) return;
    const choices = new Map((await agentChoices()).map(choice => [choice.id, choice.name]));
    const unavailable = refs.filter(agent => choices.get(agent.id) !== agent.name);
    if (!unavailable.length) return;
    const previous = input.revision ? (await readTask(workspaceId, input.id, signal)).task : undefined;
    const retained = new Map((previous ? assignmentAgents(previous) : []).map(agent => [agentKey(agent), agent.name]));
    if (unavailable.some(agent => retained.get(agentKey(agent)) !== agent.name))
      throw new BoardFailure('BOARD_AGENT_UNAVAILABLE', 403);
  }
  async function updateTask(workspaceId: string, input: TaskWrite | TaskStatusWrite, signal: AbortSignal): Promise<{ task: ProjectTask; remote: boolean }> {
    if ('task' in input) await validateAssignments(workspaceId, input, signal);
    const remote = await gateway?.({ operation: 'write', workspaceId, payload: input }, signal);
    if (remote) return { ...remote as { task: ProjectTask }, remote: true };
    const operation = pending.then(async () => {
      signal.throwIfAborted();
      const workspace = ctx.workspaceRegistry.get(workspaceId);
      if (!workspace) throw new BoardFailure('BOARD_WORKSPACE_NOT_FOUND', 404);
      if ('task' in input && input.task.sessionId && !workspace.sessionIds.includes(input.task.sessionId))
        throw new BoardFailure('BOARD_SESSION_NOT_FOUND', 404);
      return writeLocalTask(tasks, workspaceId, input);
    });
    pending = operation.then(() => {}, () => {});
    return { task: await operation, remote: false };
  }
  async function scheduleAccount(workspaceId: string, remote: boolean, signal: AbortSignal) {
    if (!remote) return null;
    const roster = await rosterSource?.(workspaceId, signal);
    if (!roster?.canAssign) throw new BoardFailure('BOARD_WRITE_FORBIDDEN', 403);
    return JSON.stringify([roster.scope, roster.viewerId]);
  }
  async function saveTask(workspaceId: string, input: TaskWrite | TaskStatusWrite, sessionId: string | null) {
    const initialTime = Date.now();
    return writeWithSchedule(async () => {
      const signal = lifetime.signal;
      const { task, remote } = await updateTask(workspaceId, input, signal);
      const key = scheduleKey(workspaceId, task.id);
      const previous = starts.get(key);
      const upcoming = 'task' in input && task.startAt !== null && task.startAt > initialTime;
      try {
        let target: Parameters<typeof syncSchedule>[4];
        if (task.status === 'todo' && task.assigneeAgent && task.startAt !== null) {
          if (!upcoming && previous?.signature === scheduleSignature(task)) return { task };
          if (upcoming) {
            const workspace = ctx.workspaceRegistry.get(workspaceId);
            const destination = [task.sessionId, previous?.sessionId, sessionId].find(id =>
              id && workspace?.sessionIds.includes(id) && !ctx.workspaceRegistry.archivedSessionIds.includes(id));
            if (!destination || (await plan(workspaceId, task, signal)).unavailable) throw new Error('BOARD_SCHEDULE_UNAVAILABLE');
            target = { sessionId: destination, account: await scheduleAccount(workspaceId, remote, signal), startAt: task.startAt };
          }
        }
        await syncSchedule(starts, schedule, key, task, target, signal);
        return { task, scheduled: Boolean(target) };
      } catch {
        return { task, scheduleFailed: true };
      }
    });
  }
  const summarize = ({
    id, title, description, status, priority, startAt, dueAt, predecessorIds, blocked, revision,
  }: ProjectTask) => ({ id, title, description, status, priority, startAt, dueAt, predecessorIds, blocked, revision });
  ctx.inject(['tools', 'sandboxPolicy'], scope => scope.effect(() => scope.tools.register(defineTool({
    name: 'ipollo_project_tasks',
    description: 'Read and update project board tasks in the current conversation’s workspace. Use for user-directed work and scheduled turns. Get the exact task before acting. If blocked is true, wait for its predecessors; if startAt is in the future, wait until then. Start or complete only after the user authorizes the work. Pass the latest revision and reread if a conflict occurs. Complete only after the actual work is done.',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'start', 'complete', 'scheduled_start'], required: true },
      taskId: { type: 'string', description: 'Task UUID for get, start and complete.' },
      after: { type: 'string', description: 'Next cursor from list.' },
      revision: { type: 'integer', description: 'Current task revision for start and complete.' },
      token: { type: 'string', description: 'Include the exact token from a project board reminder for scheduled_start only.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: args => ({ card: 'generic', title: 'Project board · ' + args.action,
      kind: args.action === 'list' || args.action === 'get' ? 'read' : 'execute' }),
    async execute(args, exec) {
      const caller = exec.agent;
      const session = caller?.session;
      const root = caller ? (nativeRoot?.(caller) ?? caller).session : undefined;
      const workspace = root && ctx.workspaceRegistry.list().find(item =>
        item.path === root.header.cwd && item.sessionIds.includes(root.id));
      if (!workspace || !root || !session || ctx.workspaceRegistry.archivedSessionIds.includes(root.id)) throw new Error('BOARD_WORKSPACE_NOT_FOUND');
      const signal = AbortSignal.any([lifetime.signal, exec.signal]);
      if (args.action === 'list') {
        const page = await listTasks(workspace.id, z.uuid().optional().parse(args.after), signal);
        return { tasks: page.tasks.map(({ description: _description, ...card }) => {
          const { id, title, status, priority, startAt, dueAt, predecessorIds, blocked, revision } = card;
          return { id, title, status, priority, startAt, dueAt, predecessorIds, blocked, revision };
        }), next: page.next };
      }
      const taskId = z.uuid().parse(args.taskId);
      if (args.action === 'get') {
        const { task } = await readTask(workspace.id, taskId, signal);
        return { task: summarize(task), ai: await plan(workspace.id, task, signal, caller) };
      }
      if (root.id !== session.id || scope.sandboxPolicy.resolve({ session }).mode === 'read-only') throw new Error('BOARD_WRITE_FORBIDDEN');
      if (args.action === 'scheduled_start') return writeWithSchedule(async () => {
        const key = scheduleKey(workspace.id, taskId);
        const link = starts.get(key);
        if (!link || link.token !== args.token || link.sessionId !== session.id ||
            !await canStartScheduledTask(schedule, link)) return { started: false, reason: 'schedule_changed' };
        const { task, remote } = await readTask(workspace.id, taskId, signal);
        if (link.signature !== scheduleSignature(task) || !task.assigneeAgent ||
            link.account !== await scheduleAccount(workspace.id, remote, signal)) return { started: false, reason: 'schedule_changed' };
        if (task.status !== 'todo') return { started: false, reason: 'task_already_started' };
        if (task.startAt === null || task.startAt > Date.now()) return { started: false, reason: 'before_start' };
        if (task.blocked) return { started: false, reason: 'waiting_for_predecessors' };
        const ai = await plan(workspace.id, task, signal, caller);
        if (ai.unavailable) return { started: false, reason: 'agent_unavailable' };
        const result = await updateTask(workspace.id, { id: task.id, revision: task.revision, status: 'doing' }, signal);
        await starts.delete(key).catch(() => {});
        return { started: true, task: summarize(result.task), ai };
      });
      const input = taskStatusSchema.parse({ id: taskId, revision: args.revision, status: args.action === 'start' ? 'doing' : 'done' });
      const current = (await readTask(workspace.id, taskId, signal)).task;
      if (current.revision !== input.revision) throw new BoardFailure('BOARD_CONFLICT', 409);
      if ((await plan(workspace.id,current,signal,caller)).unavailable) throw new BoardFailure('BOARD_AGENT_UNAVAILABLE', 403);
      if (current.startAt !== null && current.startAt > Date.now()) throw new BoardFailure('BOARD_TASK_NOT_STARTED', 409);
      if (current.status === 'done' || (input.status === 'doing' && current.status !== 'todo'))
        return { task: summarize(current) };
      return { task: summarize((await updateTask(workspace.id, input, signal)).task) };
    },
  }))));

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path,
    async handler(req, res) {
      const admission = ctx.connection.admit(req);
      if ('rejection' in admission) return send(res, admission.rejection, { error: 'unauthorized' });
      if (admission.peer.principal.kind !== 'owner' || ['same-site', 'cross-site'].includes(req.headers['sec-fetch-site'] ?? ''))
        return send(res, 403, { error: 'forbidden' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const resource = url.searchParams.get('resource');
      if (resource === 'inbox') {
        try {
          if (req.method === 'GET') {
            const noticeId = z.uuid().optional().parse(url.searchParams.get('notice') ?? undefined);
            const result = await gateway?.(noticeId ? {operation:'notice',noticeId} : {operation:'inbox'}, lifetime.signal);
            return send(res,200,result ?? {notices:[]});
          }
          if (req.method === 'PATCH') {
            const noticeId = z.uuid().parse(url.searchParams.get('notice'));
            if (url.searchParams.get('action') === 'status') {
              const payload = taskStatusSchema.omit({ id: true }).parse(await body(req));
              return send(res,200,await gateway?.({operation:'notice-status',noticeId,payload},lifetime.signal));
            }
            return send(res,200,await gateway?.({operation:'read',noticeId},lifetime.signal) ?? {ok:true});
          }
        } catch (error) {
          if (error && typeof error === 'object' && 'status' in error) {
            if (error.status === 401 && !url.searchParams.has('notice')) return send(res,200,{notices:[]});
            if (error.status === 404) return send(res,404,{error:'BOARD_NOTICE_NOT_FOUND'});
            if (typeof error.status === 'number' && 'code' in error) return send(res,error.status,{error:error.code});
          }
          return send(res,503,{error:'BOARD_SERVICE_UNAVAILABLE'});
        }
        return send(res,405,{error:'method_not_allowed'});
      }
      const selected = id.safeParse(url.searchParams.get('workspace'));
      if (!selected.success) return send(res, 400, { error: 'invalid_workspace' });
      const workspaceId = selected.data;
      try {
        const workspace = ctx.workspaceRegistry.get(workspaceId);
        if (!workspace) return send(res,404,{error:'workspace_not_found'});
        if (req.method === 'GET' && resource === 'agents') return send(res, 200, { agents: await agentChoices(), suite: Boolean(rosterSource) });
        if (req.method === 'GET' && resource === 'delegate') {
          const taskId = z.uuid().parse(url.searchParams.get('task'));
          const { task } = await readTask(workspaceId, taskId, lifetime.signal);
          return send(res, 200, { task, ai: await plan(workspaceId, task, lifetime.signal) });
        }
        if (resource === 'tasks') {
          if (req.method === 'GET') {
            const taskId = z.uuid().optional().parse(url.searchParams.get('task') ?? undefined);
            const after = z.uuid().optional().parse(url.searchParams.get('after') ?? undefined);
            const result = taskId
              ? await readTask(workspaceId, taskId, lifetime.signal)
              : await listTasks(workspaceId, after, lifetime.signal);
            return send(res, 200, result);
          }
          if (req.method !== 'PATCH') return send(res, 405, { error: 'method_not_allowed' });
          const input = z.union([taskWriteSchema, taskStatusSchema]).parse(await body(req));
          return send(res, 200, await saveTask(workspaceId, input, url.searchParams.get('session')));
        }
        if (req.method === 'GET') {
          if (url.searchParams.get('resource') === 'members') {
            try {
              const sessionId = id.optional().parse(url.searchParams.get('session') ?? undefined);
              const roster = await rosterSource?.(workspaceId, lifetime.signal, sessionId) ?? null;
              return send(res, 200, { roster });
            } catch {
              return send(res, 503, { error: 'roster_unavailable' });
            }
          }
          const archived = new Set(ctx.workspaceRegistry.archivedSessionIds);
          const entries = workspace.sessionIds.flatMap(sessionId => {
            const existing = archived.has(sessionId) ? undefined : notes.get(sessionId);
            return existing ? [[sessionId, existing] as const] : [];
          });
          return send(res, 200, { notes: Object.fromEntries(entries) });
        }
        if (req.method !== 'PATCH') return send(res, 405, { error: 'method_not_allowed' });
        const input = change.safeParse(await body(req));
        if (!input.success) return send(res, 400, { error: 'invalid_note' });
        const update = input.data;
        const assignment = update.assignment;
        if (assignment) {
          const source = rosterSource;
          let roster: ProjectRoster | null | undefined;
          try { roster = await source?.(workspaceId, lifetime.signal); }
          catch { return send(res, 503, { error: 'roster_unavailable' }); }
          if (!roster?.canAssign || roster.scope !== assignment.scope || source !== rosterSource ||
              (assignment.userId !== null && !roster.members.some(member => member.userId === assignment.userId)))
            return send(res, 403, { error: 'assignee_unavailable' });
        }
        const operation = pending.then(async () => {
          if (lifetime.signal.aborted) return send(res, 503, { error: 'unavailable' });
          const workspace = ctx.workspaceRegistry.get(workspaceId);
          if (!workspace?.sessionIds.includes(update.sessionId) || ctx.workspaceRegistry.archivedSessionIds.includes(update.sessionId))
            return send(res, 404, { error: 'session_not_found' });
          const previous = notes.get(update.sessionId);
          if ((previous?.revision ?? 0) !== update.revision)
            return send(res, 409, { error: 'conflict', note: previous });
          const next: BoardNote = {
            status: update.status === undefined ? previous?.status ?? null : update.status,
            startOn: update.startOn === undefined ? previous?.startOn ?? null : update.startOn,
            dueOn: update.dueOn === undefined ? previous?.dueOn ?? null : update.dueOn,
            revision: update.revision + 1,
            assignee: assignment
              ? assignment.userId ? { scope: assignment.scope, userId: assignment.userId } : undefined
              : previous?.assignee,
          };
          if (next.startOn && next.dueOn && next.startOn > next.dueOn)
            return send(res, 400, { error: 'invalid_note' });
          await notes.put(update.sessionId, next);
          send(res, 200, { note: next });
        });
        pending = operation.catch(() => {});
        await operation;
      } catch (error) {
        if (res.headersSent) { res.destroy(); return; }
        if (error instanceof SyntaxError || error instanceof z.ZodError) return send(res,400,{error:'invalid_note'});
        if (error instanceof BoardFailure) return send(res,error.status,{error:error.code});
        if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' &&
            'status' in error && typeof error.status === 'number' && error.status>=400 && error.status<600)
          return send(res,error.status,{error:error.code});
        send(res,503,{error:'BOARD_SERVICE_UNAVAILABLE'});
      }
    },
  }));
}
