import { calendarStart, dateOf, dateValue, shiftDay } from '../../_shared/ui/date-keys.ts';
export { dateKey, dateOf, dateValue, shiftDay, shiftMonth, todayKey } from '../../_shared/ui/date-keys.ts';
import { agentKey, type BoardAgent, type ProjectTask, type TaskDraft } from '../../../services/ipollowork/src/project-board-contract.ts';
export const statuses = ['todo', 'doing', 'review', 'done'] as const;
export type Status = typeof statuses[number];
export const views = ['board', 'list', 'calendar', 'timeline'] as const;
export type View = typeof views[number];

export interface NativeConversation {
  id: string;
  displayTitle: string;
  blank: boolean;
  running: boolean;
  updatedAt: number;
  parentId?: string;
  origin?: string;
}
export interface Project {
  workspaceId: string;
  title: string;
  sessionIds: readonly string[];
}
export interface ProjectRoster {
  scope: string;
  canAssign: boolean;
  viewerId?: string;
  projectId?: string;
  enterpriseId?: string;
  organizationName?: string;
  canInvite?: boolean;
  members: readonly { userId: string; name: string; email?: string; avatar?: string; canViewConversation?: boolean }[];
}
export type NativeAgentTool = 'subagent_codex' | 'subagent_claude_code';
export interface AgentChoice { id: string; name: string; preset: string | null; avatar?: string; nativeTool?: NativeAgentTool }
export type AgentPlan = {
  delegates: { name: string; preset: string }[];
  external: { name: string; tool: NativeAgentTool }[];
  unavailable: boolean;
  humanLead: boolean;
};
export const currentAgent: AgentChoice = { id: 'current', name: 'AI', preset: null };
export const displayAgent = (agent: BoardAgent, currentLabel: string) => agent.id === 'current' ? currentLabel : agent.name;
export interface Assignee {
  scope: string;
  userId: string;
}
export interface BoardNote {
  status: Status | null;
  startOn: string | null;
  dueOn: string | null;
  revision: number;
  assignee?: Assignee | undefined;
}
export interface Card extends BoardNote {
  id: string;
  title: string;
  status: Status;
  running: boolean;
  updatedAt: number;
  task?: ProjectTask;
}
export type NoteChange = Partial<Omit<BoardNote, 'revision' | 'assignee'>> & {
  assignment?: { scope: string; userId: string | null };
};
export function assigneeProfile(card: Pick<Card, 'assignee' | 'task'>, roster: ProjectRoster | null | undefined,
  agents: readonly AgentChoice[] = []) {
  const agent = card.task?.assigneeAgent;
  if (agent) {
    const avatar = agent.ownerId === (roster?.viewerId ?? null) ? agents.find(item => item.id === agent.id)?.avatar : undefined;
    return { name: agent.name, avatar, ai: true };
  }
  const member = roster && card.assignee?.scope === roster.scope
    ? roster.members.find(item => item.userId === card.assignee?.userId) : undefined;
  return member && { name: member.name, avatar: member.avatar, ai: false };
}
export function assigneeName(card: Pick<Card, 'assignee' | 'task'>, roster: ProjectRoster | null | undefined, currentLabel?: string) {
  const agent = card.task?.assigneeAgent;
  if (agent && currentLabel !== undefined) return displayAgent(agent, currentLabel);
  return assigneeProfile(card,roster)?.name;
}
export function projectCards(project: Project, summaries: Readonly<Record<string, NativeConversation>>,
  archived: readonly string[], notes: Readonly<Record<string, BoardNote>>): Card[] {
  const hidden = new Set(archived);
  return project.sessionIds.flatMap(id => {
    const session = summaries[id];
    if (!session || session.blank || session.parentId || session.origin === 'subagent' || hidden.has(id)) return [];
    const note = notes[id];
    return [{
      id,
      title: session.displayTitle,
      status: note?.status ?? (session.running ? 'doing' : 'todo'),
      running: session.running,
      updatedAt: session.updatedAt,
      revision: note?.revision ?? 0,
      assignee: note?.assignee,
      startOn: note?.startOn ?? null,
      dueOn: note?.dueOn ?? null,
    }];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function cardFor(task: ProjectTask, roster: ProjectRoster | null | undefined, sessions: Readonly<Record<string, NativeConversation>>): Card {
  return {
    id: task.id, title: task.title, status: task.status, revision: task.revision, task,
    running: Boolean(task.sessionId && sessions[task.sessionId]?.running), updatedAt: 0,
    startOn: dateOf(task.startAt), dueOn: dateOf(task.dueAt),
    ...(roster && task.assigneeId ? { assignee:{scope:roster.scope,userId:task.assigneeId} } : {}),
  };
}
export function taskDefaults(card?: Card, roster?: ProjectRoster | null): TaskDraft {
  if (card?.task) {
    const {id: _id, revision: _revision, blocked: _blocked,archived:_archived,deletedAt:_deletedAt, ...task} = card.task;
    return task;
  }
  return {
    title:card?.title ?? '', description:'', status:card?.status ?? 'todo', priority:'normal',
    startAt:card?.startOn ? new Date(card.startOn+'T09:00').getTime() : null,
    dueAt:card?.dueOn ? new Date(card.dueOn+'T23:59').getTime() : null,
    assigneeId:roster && card?.assignee?.scope===roster.scope ? card.assignee.userId : null,
    assigneeAgent:null, participantAgents:[], participantIds:[], predecessorIds:[], sessionId:card?.id ?? null,
  };
}

type Collaborator = string | BoardAgent;
type TaskAssignments = Pick<TaskDraft, 'assigneeId' | 'assigneeAgent' | 'participantIds' | 'participantAgents'>;
export const collaboratorKey = (member: Collaborator) => typeof member === 'string' ? 'person:'+member : 'ai:'+agentKey(member);

export function taskCollaborators(task: TaskAssignments) {
  const lead = task.assigneeAgent ?? task.assigneeId;
  const members = [...(lead ? [lead] : []), ...task.participantIds, ...(task.participantAgents ?? [])];
  return { lead: lead ? collaboratorKey(lead) : null, members: new Map(members.map(member => [collaboratorKey(member), member])) };
}

export function updateCollaborator(task: TaskDraft, member: Collaborator, action: 'toggle' | 'lead'): TaskDraft {
  const { lead, members } = taskCollaborators(task);
  const key = collaboratorKey(member);
  const currentLead = lead ? members.get(lead) ?? null : null;
  const nextLead = action === 'lead' ? lead === key ? null : member : lead === key ? null : currentLead;
  if (action === 'toggle' && members.has(key)) members.delete(key);
  else members.set(key, member);
  if (nextLead) members.delete(collaboratorKey(nextLead));
  const participants = [...members.values()];
  return {
    ...task,
    assigneeId: typeof nextLead === 'string' ? nextLead : null,
    assigneeAgent: typeof nextLead === 'string' ? null : nextLead,
    participantIds: participants.filter(person => typeof person === 'string'),
    participantAgents: participants.filter(agent => typeof agent !== 'string'),
  };
}
export interface DateRange { from: string; to: string }

export function dateRange(view: 'calendar' | 'timeline', anchor: string): DateRange {
  if (view === 'timeline') return { from: anchor, to: shiftDay(anchor, 27) };
  const from = calendarStart(anchor);
  return { from, to: shiftDay(from, 41) };
}
export function span(task: Pick<Card, 'startOn' | 'dueOn'>): DateRange | null {
  const from = task.startOn ?? task.dueOn;
  const to = task.dueOn ?? task.startOn;
  return from && to ? { from, to } : null;
}
export function dayOffset(from: string, to: string): number {
  return (dateValue(to).getTime() - dateValue(from).getTime()) / 86_400_000;
}
export function timelinePosition(task: Pick<Card, 'startOn' | 'dueOn'>, range: DateRange) {
  const dates = span(task);
  if (!dates || dates.to < range.from || dates.from > range.to) return null;
  const total = dayOffset(range.from, range.to) + 1;
  const start = Math.max(0, dayOffset(range.from, dates.from));
  const end = Math.min(total, dayOffset(range.from, dates.to) + 1);
  return { left: `${100 * start / total}%`, width: `${100 * (end - start) / total}%` };
}
