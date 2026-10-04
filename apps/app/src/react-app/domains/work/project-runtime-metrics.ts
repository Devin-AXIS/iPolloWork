import type { ProjectAgent } from "@ipollowork/types/project-workspace";
import type { WorkItem } from "@ipollowork/types/work-items";
import type { SessionTokenMetering } from "@ipollowork/types/workspace";

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
  agentId: string | null;
  agentName: string | null;
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
  sessionUsage: (Pick<ProjectRuntimeExecutionRecord, "sessionId" | "title" | "tokens"> & { isMain: boolean })[];
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

function sessionTokens(session: SessionTokenMetering & {
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache?: { read: number; write: number };
  };
}): number | null {
  if (typeof session.totalTokens === "number" && Number.isSafeInteger(session.totalTokens) && session.totalTokens >= 0) {
    return session.totalTokens;
  }
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
    const nativeRole = text.match(/\bipw-[a-zA-Z0-9_-]+\.([a-zA-Z0-9_-]+)/u)?.[1];
    if (nativeRole && configuredIds.has(nativeRole)) return nativeRole;
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

function nativeCodexAgent(session: unknown): Record<string, unknown> | null {
  return isRecord(session) && isRecord(session.codex) && session.codex.subagent === true
    ? session.codex : null;
}

function agentIdFromSession(session: RuntimeSession, agents: ProjectAgent[]): string | null {
  const nativeRole = readString(nativeCodexAgent(session), "agentRole");
  if (nativeRole) return agentIdFromText([nativeRole], agents);
  const identity = readString(session, "agent")?.toLocaleLowerCase();
  if (identity) {
    const matchingAgent = agents.find((agent) => (
      agent.id.toLocaleLowerCase() === identity || agent.name.trim().toLocaleLowerCase() === identity
    ));
    if (matchingAgent) return matchingAgent.id;
  }
  return readString(session, "engineId") === "codex-harness" ? null : agentIdFromText([session.title], agents);
}

type DelegatedAgentBinding = {
  agentId: string | null;
  description: string | null;
  status: "running" | "completed" | "failed" | "unknown";
};

function taskDelegation(part: unknown): {
  childSessionId: string;
  parentSessionId: string | null;
  createsChild: boolean;
  nativeActivity: boolean;
  description: string | null;
  prompt: string | null;
  status: DelegatedAgentBinding["status"];
} | null {
  if (!isRecord(part) || part.type !== "tool" || part.tool !== "task") return null;
  const state = part.state;
  if (!isRecord(state)) return null;
  const output = readString(state, "output");
  const childSessionId = readString(state.metadata, "sessionId")
    ?? output?.match(/<task\s+id=["']([^"']+)["']/iu)?.[1]?.trim();
  if (!childSessionId) return null;
  const input = state.input;
  const nativeTool = readString(state.metadata, "nativeTool");
  const nativeActivity = nativeTool === "subAgentActivity";
  const nativeStatus = readString(state.metadata, "delegationStatus");
  return {
    childSessionId,
    parentSessionId: readString(state.metadata, "parentSessionId"),
    createsChild: !nativeTool || nativeTool === "spawnAgent"
      || (nativeActivity && readString(state.metadata, "nativeKind") === "started" && Boolean(readString(state.metadata, "parentSessionId"))),
    nativeActivity,
    description: readString(input, "description"),
    prompt: [readString(input, "subagent_type"), readString(input, "prompt")].filter(Boolean).join("\n") || null,
    status: nativeStatus === "running" || nativeStatus === "completed" || nativeStatus === "failed" || nativeStatus === "unknown"
      ? nativeStatus
      : state.status === "completed"
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
  rootSessionIds: Set<string>;
  agents: ProjectAgent[];
}): Promise<{ agents: Map<string, DelegatedAgentBinding>; parents: Map<string, string> }> {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const parents = new Map<string, string>();
  const childIdsByParentId = new Map<string, Set<string>>();
  for (const session of input.sessions) {
    if (!session.parentID) continue;
    if (readString(session, "engineId") === "codex-harness" && !nativeCodexAgent(session)) continue;
    parents.set(session.id, session.parentID);
    const childIds = childIdsByParentId.get(session.parentID) ?? new Set<string>();
    childIds.add(session.id);
    childIdsByParentId.set(session.parentID, childIds);
  }

  const result = new Map<string, DelegatedAgentBinding>();
  const visited = new Set<string>();
  let frontier = [...input.rootSessionIds].filter((sessionId) => sessionsById.has(sessionId));
  while (frontier.length > 0) {
    const next = new Set<string>();
    await mapWithConcurrency(frontier, 4, async (parentSessionId) => {
      visited.add(parentSessionId);
      for (const childId of childIdsByParentId.get(parentSessionId) ?? []) next.add(childId);
      try {
        const response = await input.client.getSessionMessages(input.workspaceId, parentSessionId, { limit: 100 });
        // Codex SubAgentActivity has no task prompt. A worker may explicitly
        // identify its preset in its own result; do not infer one from its prose.
        const binding = result.get(parentSessionId);
        if (binding && !binding.agentId && nativeCodexAgent(sessionsById.get(parentSessionId))) {
          const markedId = response.items.flatMap((message) => readString(message.info, "role") === "assistant" ? message.parts : [])
            .flatMap((part) => {
              const text = readString(part, "type") === "text" ? readString(part, "text") : null;
              return text?.trimStart().startsWith("[project-agent:") ? [markedProjectAgentId(text)] : [];
            }).find((id) => input.agents.some((agent) => agent.id === id));
          if (markedId) binding.agentId = markedId;
        }
        for (const message of response.items) {
          for (const part of message.parts) {
            const delegation = taskDelegation(part);
            if (!delegation || !sessionsById.has(delegation.childSessionId)) continue;
            if (delegation.createsChild
              && (!delegation.parentSessionId || delegation.parentSessionId === parentSessionId)
              && !parents.has(delegation.childSessionId)
              && !input.rootSessionIds.has(delegation.childSessionId)) {
              parents.set(delegation.childSessionId, parentSessionId);
            }
            if (parents.get(delegation.childSessionId) !== parentSessionId) continue;
            next.add(delegation.childSessionId);
            const previous = result.get(delegation.childSessionId);
            const childSession = sessionsById.get(delegation.childSessionId);
            const childRole = readString(nativeCodexAgent(childSession), "agentRole");
            const configuredNativeRole = childRole ? agentIdFromText([childRole], input.agents) : null;
            const markedRole = delegation.prompt ? markedProjectAgentId(delegation.prompt) : null;
            const configuredMarkedRole = input.agents.find((agent) => agent.id === markedRole)?.id;
            const nativeAgentId = delegation.nativeActivity
              ? delegation.description?.split("/").reverse().map((segment) => {
                const role = segment.replace(/^ipw-[a-zA-Z0-9_-]+\./u, "");
                return input.agents.find((agent) => role === agent.id || role.startsWith(`${agent.id}__`))?.id;
              }).find(Boolean)
              : null;
            const agentId = configuredMarkedRole ?? configuredNativeRole ?? (delegation.nativeActivity
              ? input.agents.find((agent) => agent.id === nativeAgentId)?.id
              : agentIdFromText([delegation.description, delegation.prompt], input.agents)) ?? previous?.agentId ?? null;
            result.set(delegation.childSessionId, {
              agentId,
              description: delegation.description ?? previous?.description ?? null,
              status: delegation.status === "unknown" ? previous?.status ?? "unknown" : delegation.status,
            });
          }
        }
      } catch {
        // Engines without task-message history still contribute to the project total.
        // Their usage remains explicitly unattributed instead of being guessed.
      }
    });
    frontier = [...next].filter((sessionId) => !visited.has(sessionId));
  }
  return { agents: result, parents };
}

export async function loadProjectRuntimeMetrics(input: {
  client: iPolloWorkServerClient;
  workspaceId: string;
  agents: ProjectAgent[];
  items: WorkItem[];
}): Promise<ProjectRuntimeMetrics> {
  const sessions = [...new Map((await input.client.listSessions(input.workspaceId)).items.map(session => [session.id, session])).values()];
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
  const delegations = await delegatedAgentIds({
    client: input.client,
    workspaceId: input.workspaceId,
    sessions,
    rootSessionIds: new Set(executionBySessionId.keys()),
    agents: input.agents,
  });
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
      currentId = delegations.parents.get(currentId);
    }
    for (const visitedId of visited) rootExecutionCache.set(visitedId, null);
    return null;
  };
  const projectSessions = sessions.flatMap((session) => {
    const execution = rootExecutionForSession(session.id);
    return execution ? [{ execution, session }] : [];
  });
  let totalTokens = 0;
  let attributedTokens = 0;
  let meteredConversationCount = 0;
  const executionRecords: ProjectRuntimeExecutionRecord[] = [];
  const sessionUsage: ProjectRuntimeMetrics["sessionUsage"] = [];

  for (const { execution, session } of projectSessions) {
    const rootSession = execution.sessionId === session.id;
    const delegatedAgent = delegations.agents.get(session.id);
    const agentId = rootSession
      ? execution.agent.id
      : delegatedAgent ? delegatedAgent.agentId : agentIdFromSession(session, input.agents);
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
    }
    const tokens = sessionTokens(session);
    sessionUsage.push({
      sessionId: session.id,
      title: delegatedAgent?.description ?? session.title,
      tokens,
      isMain: !delegations.parents.has(session.id),
    });
    if (!rootSession) {
      const rootTask = workItemBySessionId.get(execution.sessionId);
      executionRecords.push({
        sessionId: session.id,
        rootSessionId: execution.sessionId,
        rootTaskId: rootTask?.id ?? "",
        rootTaskTitle: rootTask?.title ?? "",
        agentId,
        agentName: agentId ? input.agents.find((agent) => agent.id === agentId)?.name ?? agentId : null,
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
      : missingMeterCount > 0
      ? "partial"
      : "complete",
    unmeteredConversationCount: missingMeterCount,
    agents,
    sessionUsage: sessionUsage.sort((left, right) => Number(right.isMain) - Number(left.isMain)),
    executionRecords: executionRecords.sort((left, right) => right.updatedAt - left.updatedAt),
  };
}
