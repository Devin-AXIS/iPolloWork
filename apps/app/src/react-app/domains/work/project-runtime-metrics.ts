import type { ProjectAgent } from "@ipollowork/types/project-workspace";
import type { WorkItem } from "@ipollowork/types/work-items";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";

type ProjectExecution = NonNullable<WorkItem["execution"]>;
type RuntimeSession = Awaited<ReturnType<iPolloWorkServerClient["listSessions"]>>["items"][number];

export type AgentRuntimeUsage = {
  agentId: string;
  conversationCount: number;
  tokens: number;
  attributed: boolean;
  executions: {
    running: number;
    completed: number;
    failed: number;
  };
  recentConversation: {
    sessionId: string;
    title: string;
    updatedAt: number;
    status: "running" | "completed" | "failed" | "unknown";
  } | null;
};

export type ProjectRuntimeExecutionRecord = {
  sessionId: string;
  rootSessionId: string;
  rootTaskId: string;
  rootTaskTitle: string;
  agentId: string;
  agentName: string;
  title: string;
  status: "running" | "completed" | "failed" | "unknown";
  tokens: number | null;
  startedAt: number;
  updatedAt: number;
};

export type ProjectRuntimeMetrics = {
  conversationCount: number;
  meteredConversationCount: number;
  totalTokens: number | null;
  averageTokensPerConversation: number | null;
  attributedTokens: number;
  unattributedTokens: number | null;
  status: "complete" | "partial" | "unavailable";
  unmeteredConversationCount: number;
  agents: AgentRuntimeUsage[];
  executionRecords: ProjectRuntimeExecutionRecord[];
};

function emptyAgentUsage(agents: ProjectAgent[]): AgentRuntimeUsage[] {
  return agents.map((agent) => ({
    agentId: agent.id,
    conversationCount: 0,
    tokens: 0,
    attributed: false,
    executions: { running: 0, completed: 0, failed: 0 },
    recentConversation: null,
  }));
}

function sessionTokens(session: {
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache?: { read: number; write: number };
  };
}): number | null {
  if (!session.tokens) return null;
  return Math.max(
    0,
    session.tokens.input
      + session.tokens.output
      + session.tokens.reasoning
      + (session.tokens.cache?.read ?? 0)
      + (session.tokens.cache?.write ?? 0),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function markedProjectAgentId(text: string): string | null {
  return text.match(/\[project-agent:([^\]\s]+)\]/iu)?.[1]?.trim() ?? null;
}

const PROJECT_AGENT_ROLE_SUFFIXES = [
  "负责人",
  "工程师",
  "分析师",
  "设计师",
  "研究员",
  "专员",
  "主管",
  "经理",
  "顾问",
  "编辑",
  "作者",
  "员",
  "师",
] as const;

function normalizedRoleText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function projectAgentRoleStem(name: string): string | null {
  const normalized = normalizedRoleText(name);
  for (const suffix of PROJECT_AGENT_ROLE_SUFFIXES) {
    if (!normalized.endsWith(suffix)) continue;
    const stem = normalized.slice(0, -suffix.length);
    if (stem.length >= 4) return stem;
  }
  return null;
}

function agentIdFromText(texts: Array<string | null>, agents: ProjectAgent[]): string | null {
  const configuredIds = new Set(agents.map((agent) => agent.id));
  for (const text of texts) {
    if (!text) continue;
    const markedId = markedProjectAgentId(text);
    if (markedId && configuredIds.has(markedId)) return markedId;
  }

  const content = texts.filter(Boolean).join("\n").toLocaleLowerCase();
  const matches = agents
    .filter((agent) => agent.name.trim() && content.includes(agent.name.trim().toLocaleLowerCase()))
    .sort((left, right) => right.name.trim().length - left.name.trim().length);
  if (matches[0]) return matches[0].id;

  const normalizedContent = normalizedRoleText(content);
  const stemMatches = agents.flatMap((agent) => {
    const stem = projectAgentRoleStem(agent.name);
    return stem && normalizedContent.includes(stem) ? [{ agent, stem }] : [];
  }).sort((left, right) => right.stem.length - left.stem.length);
  if (!stemMatches[0]) return null;
  const strongestLength = stemMatches[0].stem.length;
  const strongestMatches = stemMatches.filter(({ stem }) => stem.length === strongestLength);
  return strongestMatches.length === 1 ? strongestMatches[0]?.agent.id ?? null : null;
}

function agentIdFromSession(session: RuntimeSession, agents: ProjectAgent[]): string | null {
  const identity = readString(session, "agent")?.toLocaleLowerCase();
  if (identity) {
    const matchingAgent = agents.find((agent) => (
      agent.id.toLocaleLowerCase() === identity || agent.name.trim().toLocaleLowerCase() === identity
    ));
    if (matchingAgent) return matchingAgent.id;
  }
  return agentIdFromText([session.title], agents);
}

type DelegatedAgentBinding = {
  agentId: string;
  description: string | null;
  status: "running" | "completed" | "failed" | "unknown";
};

function taskDelegation(part: unknown): {
  childSessionId: string;
  description: string | null;
  prompt: string | null;
  status: DelegatedAgentBinding["status"];
} | null {
  if (!isRecord(part) || part.type !== "tool" || part.tool !== "task") return null;
  const state = part.state;
  if (!isRecord(state)) return null;
  const output = readString(state, "output");
  const childSessionId = output?.match(/<task\s+id=["']([^"']+)["']/iu)?.[1]?.trim();
  if (!childSessionId) return null;
  const input = state.input;
  return {
    childSessionId,
    description: readString(input, "description"),
    prompt: readString(input, "prompt"),
    status: state.status === "completed"
      ? "completed"
      : state.status === "running"
        ? "running"
        : state.status === "error"
          ? "failed"
          : "unknown",
  };
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  const queue = [...values];
  const workerCount = Math.min(Math.max(1, concurrency), queue.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const value = queue.shift();
      if (value === undefined) return;
      await visit(value);
    }
  }));
}

async function delegatedAgentIds(input: {
  client: iPolloWorkServerClient;
  workspaceId: string;
  sessions: RuntimeSession[];
  projectSessionIds: Set<string>;
  agents: ProjectAgent[];
}): Promise<Map<string, DelegatedAgentBinding>> {
  const childIdsByParentId = new Map<string, Set<string>>();
  for (const session of input.sessions) {
    if (!input.projectSessionIds.has(session.id) || !session.parentID) continue;
    const childIds = childIdsByParentId.get(session.parentID) ?? new Set<string>();
    childIds.add(session.id);
    childIdsByParentId.set(session.parentID, childIds);
  }

  const result = new Map<string, DelegatedAgentBinding>();
  await mapWithConcurrency([...childIdsByParentId.entries()], 4, async ([parentSessionId, childSessionIds]) => {
    try {
      const response = await input.client.getSessionMessages(input.workspaceId, parentSessionId, { limit: 100 });
      for (const message of response.items) {
        for (const part of message.parts) {
          const delegation = taskDelegation(part);
          if (!delegation || !childSessionIds.has(delegation.childSessionId)) continue;
          const agentId = agentIdFromText([delegation.description, delegation.prompt], input.agents);
          if (agentId) {
            result.set(delegation.childSessionId, {
              agentId,
              description: delegation.description,
              status: delegation.status,
            });
          }
        }
      }
    } catch {
      // Engines without task-message history still contribute to the project total.
      // Their usage remains explicitly unattributed instead of being guessed.
    }
  });
  return result;
}

export async function loadProjectRuntimeMetrics(input: {
  client: iPolloWorkServerClient;
  workspaceId: string;
  agents: ProjectAgent[];
  items: WorkItem[];
}): Promise<ProjectRuntimeMetrics> {
  const sessions = (await input.client.listSessions(input.workspaceId)).items;
  const agents = emptyAgentUsage(input.agents);
  const usageByAgent = new Map(agents.map((usage) => [usage.agentId, usage]));
  const executionBySessionId = new Map<string, ProjectExecution>();
  const workItemBySessionId = new Map<string, WorkItem>();
  for (const item of input.items) {
    if (item.execution) {
      executionBySessionId.set(item.execution.sessionId, item.execution);
      workItemBySessionId.set(item.execution.sessionId, item);
    }
  }
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const rootExecutionCache = new Map<string, ProjectExecution | null>();
  const rootExecutionForSession = (sessionId: string): ProjectExecution | null => {
    const cached = rootExecutionCache.get(sessionId);
    if (cached !== undefined) return cached;
    const visited = new Set<string>();
    let currentId: string | undefined = sessionId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const execution = executionBySessionId.get(currentId);
      if (execution) {
        for (const visitedId of visited) rootExecutionCache.set(visitedId, execution);
        return execution;
      }
      currentId = sessionsById.get(currentId)?.parentID;
    }
    for (const visitedId of visited) rootExecutionCache.set(visitedId, null);
    return null;
  };
  const projectSessions = sessions.flatMap((session) => {
    const execution = rootExecutionForSession(session.id);
    return execution ? [{ execution, session }] : [];
  });
  const projectSessionIds = new Set(projectSessions.map(({ session }) => session.id));
  const delegatedAgents = await delegatedAgentIds({
    client: input.client,
    workspaceId: input.workspaceId,
    sessions,
    projectSessionIds,
    agents: input.agents,
  });
  let totalTokens = 0;
  let attributedTokens = 0;
  let unattributedConversationCount = 0;
  let meteredConversationCount = 0;
  const executionRecords: ProjectRuntimeExecutionRecord[] = [];

  for (const { execution, session } of projectSessions) {
    const rootSession = execution.sessionId === session.id;
    const delegatedAgent = delegatedAgents.get(session.id);
    const agentId = rootSession
      ? execution.agent.id
      : delegatedAgent?.agentId ?? agentIdFromSession(session, input.agents);
    const agentUsage = agentId ? usageByAgent.get(agentId) : undefined;
    if (agentUsage) {
      agentUsage.conversationCount += 1;
      agentUsage.attributed = true;
      if (agentUsage.recentConversation === null || session.time.updated > agentUsage.recentConversation.updatedAt) {
        agentUsage.recentConversation = {
          sessionId: session.id,
          title: delegatedAgent?.description ?? session.title,
          updatedAt: session.time.updated,
          status: delegatedAgent?.status ?? "unknown",
        };
      }
      if (!rootSession && delegatedAgent?.status === "running") agentUsage.executions.running += 1;
      if (!rootSession && delegatedAgent?.status === "completed") agentUsage.executions.completed += 1;
      if (!rootSession && delegatedAgent?.status === "failed") agentUsage.executions.failed += 1;
    } else {
      unattributedConversationCount += 1;
    }
    const tokens = sessionTokens(session);
    if (!rootSession && agentUsage && agentId) {
      const rootTask = workItemBySessionId.get(execution.sessionId);
      executionRecords.push({
        sessionId: session.id,
        rootSessionId: execution.sessionId,
        rootTaskId: rootTask?.id ?? "",
        rootTaskTitle: rootTask?.title ?? "",
        agentId,
        agentName: input.agents.find((agent) => agent.id === agentId)?.name ?? agentId,
        title: delegatedAgent?.description ?? session.title,
        status: delegatedAgent?.status ?? "unknown",
        tokens,
        startedAt: session.time.created,
        updatedAt: session.time.updated,
      });
    }
    if (tokens === null) continue;
    meteredConversationCount += 1;
    totalTokens += tokens;
    if (!agentUsage) continue;
    agentUsage.tokens += tokens;
    attributedTokens += tokens;
  }

  const missingMeterCount = projectSessions.length - meteredConversationCount;
  const unattributedTokens = totalTokens - attributedTokens;
  const unavailable = projectSessions.length > 0 && meteredConversationCount === 0;
  return {
    conversationCount: projectSessions.length,
    meteredConversationCount,
    totalTokens: unavailable ? null : totalTokens,
    averageTokensPerConversation: unavailable
      ? null
      : meteredConversationCount > 0
      ? Math.round(totalTokens / meteredConversationCount)
      : 0,
    attributedTokens,
    unattributedTokens: unavailable ? null : unattributedTokens,
    status: unavailable
      ? "unavailable"
      : missingMeterCount > 0 || unattributedConversationCount > 0
      ? "partial"
      : "complete",
    unmeteredConversationCount: missingMeterCount,
    agents,
    executionRecords: executionRecords.sort((left, right) => right.updatedAt - left.updatedAt),
  };
}
