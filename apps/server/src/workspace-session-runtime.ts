import { prepareEnterpriseSkills, prepareStandaloneSkills } from "./skill-packages.js";
import { setTimeout as delay } from "node:timers/promises";
import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  CODEX_HARNESS_ENGINE_ID,
  DEFAULT_ENGINE_ID,
  deepSeekHarnessRuntimeProviderId,
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX,
  type DeepSeekHarnessModelDirectory,
} from "@ipollowork/types/workspace";

import {
  codexHarnessRuntimeProviderId,
  type CodexHarnessRuntimePool,
} from "./codex-harness-runtime.js";
import {
  mapCodexThread,
  readCodexHarnessThread,
  type CodexThread,
} from "./codex-harness-session-read-model.js";
import {
  readDeepSeekHarnessSnapshot,
  readDeepSeekHarnessSession,
  workspacePathMatches,
  type DeepSeekHarnessSummary,
  type DeepSeekHarnessHistory,
} from "./deepseek-harness-session-read-model.js";
import type { DeepSeekHarnessRuntimePool } from "./deepseek-harness-runtime.js";
import { join } from "node:path";
import { sessionArtifactCleanup, deleteSessionArtifactRecords } from "./session-artifacts.js";
import { assertResourceWritable, beginResourceDeletion, deleteResourceRecords, forgetResourceLifecycle, listResourceLifecycles, markResourceEngineDeleted, readResourceLifecycle, rememberResourceSummaries, removeOwnedFiles, validateProjectDeletion, verifyCleanupPath } from "./resource-lifecycle.js";
import { releaseOwnedVideoJobs } from "./extensions/video-generation.js";
import { deleteWorkspacePluginServiceData } from "./plugin-service-runtime.js";
import { beginResourceOperation, releaseResourceOperations } from "./resource-lifecycle.js";
import { ApiError } from "./errors.js";
import { StdioJsonRpcError } from "./stdio-json-rpc-runtime.js";
import { readEnhancementExecution, finishEnhancementExecution } from "./extensions/video-enhancement.js";
import { reconcilePluginPackagesForWorkspace } from "./plugin-package-lifecycle.js";
import {
  buildSession,
  buildSessionList,
  buildSessionMessages,
  buildSessionStatuses,
  type SessionInfoReadModel,
  type SessionMessageReadModel,
  type SessionStatusReadModel,
} from "./session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { bindConversationSession, deleteWorkItem, deleteWorkspaceWorkState, listBoundSessionEngines, readProjectSessionWorkItem, startProjectSessionExecution } from "./work-items.js";

type WorkspaceOpencodeClient = ReturnType<typeof createOpencodeClient>;
type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

export type UnwrapOpencodeResult = <T, E>(
  result: OpencodeClientResult<T, E>,
  path: string,
) => NonNullable<T>;

export type WorkspaceSessionModel = {
  providerID: string;
  modelID: string;
};

export type WorkspaceSessionPromptInput = {
  text: string;
  model?: WorkspaceSessionModel;
  mode?: string;
  reasoningEffort?: string;
  clientTimeZone?: string;
  system?: string;
};

export type WorkspaceSessionCompletion =
  | { status: "done" }
  | { status: "failed"; error: string };

export type WorkspaceSessionCompletionTarget = { turnId?: string; startedAt?: number };

/** Native children keep their parent engine without creating synthetic work roots. */
export async function resolveWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  runtimes: { codexHarness?: CodexHarnessRuntimePool; deepseekHarness?: DeepSeekHarnessRuntimePool },
): Promise<WorkspaceInfo> {
  const lifecycle = await readResourceLifecycle(config, workspace.id, sessionId);
  if (lifecycle?.engineId) return { ...workspace, engineId: lifecycle.engineId };
  const binding = await readProjectSessionWorkItem(config, workspace.id, sessionId);
  if (binding?.execution) return { ...workspace, engineId: binding.execution.runtime.engineId };
  const engines = new Set([workspace.engineId || DEFAULT_ENGINE_ID, ...await listBoundSessionEngines(config, workspace.id)]);
  let foundUnverifiedChild = false;
  for (const engineId of engines) {
    if (engineId !== CODEX_HARNESS_ENGINE_ID && engineId !== DEEPSEEK_HARNESS_ENGINE_ID) continue;
    const engineWorkspace = { ...workspace, engineId };
    let readMetadata: ((id: string) => Promise<{ cwd?: string; parentId?: string | null } | null>) | null = null;
    if (engineId === CODEX_HARNESS_ENGINE_ID && runtimes.codexHarness) {
      const runtime = runtimes.codexHarness.forWorkspace(engineWorkspace);
      readMetadata = async (id) => {
        const result = await runtime.call<{ thread?: CodexThread }>("thread/read", { threadId: id, includeTurns: false });
        return result.thread?.id === id ? { cwd: result.thread.cwd, parentId: result.thread.parentThreadId } : null;
      };
    } else if (engineId === DEEPSEEK_HARNESS_ENGINE_ID && runtimes.deepseekHarness) {
      const result = await runtimes.deepseekHarness.forWorkspace(engineWorkspace).call<{ items: DeepSeekHarnessSummary[] }>("session.list", {}).catch(() => null);
      const summaries = new Map((result?.items ?? []).slice(0, 2_000).map((summary) => [summary.sessionId, summary]));
      readMetadata = async (id) => {
        const summary = summaries.get(id);
        return summary ? { cwd: summary.cwd, parentId: summary.parentSessionId } : null;
      };
    }
    if (!readMetadata) continue;
    const visited = new Set<string>();
    let currentId = sessionId;
    let child = false;
    for (let depth = 0; depth < 16 && !visited.has(currentId); depth++) {
      visited.add(currentId);
      const metadata = await readMetadata(currentId).catch(() => null);
      if (!metadata) break;
      if (!workspacePathMatches(metadata.cwd, workspace.path)) {
        foundUnverifiedChild = true;
        break;
      }
      const parentBinding = currentId === sessionId ? null : await readProjectSessionWorkItem(config, workspace.id, currentId);
      if (parentBinding?.execution) {
        if (parentBinding.execution.runtime.engineId === engineId) return engineWorkspace;
        foundUnverifiedChild = true;
        break;
      }
      const parentId = metadata.parentId?.trim();
      if (!parentId) {
        if (child) foundUnverifiedChild = true;
        break;
      }
      child = true;
      foundUnverifiedChild = true;
      currentId = parentId;
    }
  }
  if (foundUnverifiedChild) throw new ApiError(404, "session_not_found", "Session does not belong to this workspace's bound conversation tree");
  return workspace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }
  return fallback;
}

export function deepSeekHarnessCompletion(
  history: DeepSeekHarnessHistory,
  target: WorkspaceSessionCompletionTarget = {},
): WorkspaceSessionCompletion | null {
  for (let index = history.events.length - 1; index >= 0; index -= 1) {
    const event = history.events[index]?.event;
    if (event?.type !== "turn/end") continue;
    if (target.startedAt !== undefined && event.time < target.startedAt) return null;
    const data = isRecord(event.data) ? event.data : null;
    const reason = data && isRecord(data.reason) ? data.reason : null;
    if (reason?.kind === "error") {
      return {
        status: "failed",
        error: errorMessage(reason.error, "DeepSeek Harness task failed"),
      };
    }
    if (["cancelled", "canceled", "interrupted"].includes(String(reason?.kind))) {
      return { status: "failed", error: "DeepSeek Harness task was interrupted" };
    }
    return { status: "done" };
  }
  return null;
}

export function codexHarnessCompletion(
  thread: CodexThread,
  target: WorkspaceSessionCompletionTarget = {},
): WorkspaceSessionCompletion | null {
  // Persisted turn history can briefly report a terminal state while the
  // native thread is still executing or awaiting approval. Do not finish the
  // conversation from that history until the native runtime has settled.
  if (thread.status?.type === "active") return null;
  const turn = target.turnId ? thread.turns?.find((candidate) => candidate.id === target.turnId) : thread.turns?.at(-1);
  if (!turn) return null;
  if (turn.completedAt === null) return null;
  if (target.startedAt !== undefined && (!turn.startedAt || turn.startedAt * 1_000 < Math.floor(target.startedAt / 1_000) * 1_000)) return null;
  if (turn.status === "completed") return { status: "done" };
  if (["failed", "cancelled", "interrupted"].includes(turn.status)) {
    return {
      status: "failed",
      error: errorMessage(turn.error, "Codex task failed"),
    };
  }
  return null;
}

export function opencodeCompletion(input: {
  sessionId: string;
  messages: SessionMessageReadModel[];
  statuses: Record<string, SessionStatusReadModel>;
  startedAt?: number;
}): WorkspaceSessionCompletion | null {
  const status = input.statuses[input.sessionId];
  if (status && status.type !== "idle") return null;
  const assistant = [...input.messages].reverse().find((message) => message.info.role === "assistant");
  if (!assistant) return null;
  if (input.startedAt !== undefined && (!assistant.info.time?.created || assistant.info.time.created < input.startedAt)) return null;
  const failure = isRecord(assistant.info) ? assistant.info.error : undefined;
  return failure
    ? { status: "failed", error: errorMessage(failure, "OpenCode task failed") }
    : { status: "done" };
}

export function buildCodexHarnessAdditionalContext(
  system: unknown,
  pluginInstructions: readonly string[],
  model?: WorkspaceSessionModel | null,
): Record<string, { value: string; kind: "application" }> | undefined {
  const context: Record<string, { value: string; kind: "application" }> = {};
  // Codex bounds each additionalContext entry independently. A single long
  // runtime entry silently loses its middle (including delivery requirements).
  // Bound UTF-8 bytes, not JS characters, so CJK text stays below that budget.
  const addContext = (key: string, text: string) => {
    const chunks: string[] = [];
    let chunk = "";
    let bytes = 0;
    for (const character of text) {
      const size = Buffer.byteLength(character, "utf8");
      if (bytes + size > 768) {
        chunks.push(chunk);
        chunk = "";
        bytes = 0;
      }
      chunk += character;
      bytes += size;
    }
    if (chunk) chunks.push(chunk);
    chunks.forEach((value, index) => {
      const source = chunks.length === 1 ? key : `${key}.${String(index).padStart(4, "0")}`;
      context[source] = { value, kind: "application" };
    });
  };
  if (typeof system === "string") addContext("ipollowork.runtime", system.trim());
  addContext("ipollowork.plugins", pluginInstructions.map((instruction) => instruction.trim()).filter(Boolean).join("\n\n"));
  const providerID = model?.providerID.trim();
  const modelID = model?.modelID.trim();
  if (providerID && modelID) {
    context["ipollowork.model"] = {
      value: `Authoritative iPolloWork runtime model selection: providerID="${providerID}", modelID="${modelID}". When asked which model is running, report this selection instead of inferring identity from Codex host instructions or earlier assistant messages.`,
      kind: "application",
    };
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

function deepSeekSystemContent(system: string): { type: "text"; text: string } {
  return {
    type: "text",
    text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}${system}\n</system>`,
  };
}

export class WorkspaceSessionRuntime {
  readonly #config: ServerConfig;
  readonly #createWorkspaceOpencodeClient: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
  ) => WorkspaceOpencodeClient;
  readonly #unwrapOpencodeResult: UnwrapOpencodeResult;
  readonly #deepseekHarness: DeepSeekHarnessRuntimePool;
  readonly #codexHarness: CodexHarnessRuntimePool;
  readonly #prepareOpencodePrompt?: (workspace: WorkspaceInfo) => Promise<void>;
  readonly #freshCodexThreads = new Map<string, WorkspaceSessionModel>();
  readonly #sessionContextHints = new Map<string, string>();
  readonly #lifecycleOperations = new Map<string, Promise<unknown>>();
  readonly #releaseSessionObservers?: (workspaceId: string, sessionId?: string) => Promise<void>;

  constructor(input: {
    config: ServerConfig;
    createWorkspaceOpencodeClient: (
      config: ServerConfig,
      workspace: WorkspaceInfo,
    ) => WorkspaceOpencodeClient;
    unwrapOpencodeResult: UnwrapOpencodeResult;
    deepseekHarness: DeepSeekHarnessRuntimePool;
    codexHarness: CodexHarnessRuntimePool;
    prepareOpencodePrompt?: (workspace: WorkspaceInfo) => Promise<void>;
    releaseSessionObservers?: (workspaceId: string, sessionId?: string) => Promise<void>;
  }) {
    this.#config = input.config;
    this.#createWorkspaceOpencodeClient = input.createWorkspaceOpencodeClient;
    this.#unwrapOpencodeResult = input.unwrapOpencodeResult;
    this.#deepseekHarness = input.deepseekHarness;
    this.#codexHarness = input.codexHarness;
    this.#prepareOpencodePrompt = input.prepareOpencodePrompt;
    this.#releaseSessionObservers = input.releaseSessionObservers;
  }

  #codexThreadKey(workspaceId: string, threadId: string): string {
    return `${workspaceId}\u0000${threadId}`;
  }

  #rememberFreshCodexThread(key: string, model: WorkspaceSessionModel): void {
    this.#freshCodexThreads.set(key, model);
    while (this.#freshCodexThreads.size > 500) {
      const oldest = this.#freshCodexThreads.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#freshCodexThreads.delete(oldest);
    }
  }

  sessionContextHint(workspaceId: string): string | null {
    return this.#sessionContextHints.get(workspaceId) ?? null;
  }

  rememberSessionContext(workspaceId: string, sessionId: string): void {
    this.#rememberSessionContext(workspaceId, sessionId);
  }

  #rememberSessionContext(workspaceId: string, sessionId: string): void {
    this.#sessionContextHints.delete(workspaceId);
    this.#sessionContextHints.set(workspaceId, sessionId);
    while (this.#sessionContextHints.size > 500) {
      const oldest = this.#sessionContextHints.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#sessionContextHints.delete(oldest);
    }
  }

  async preparePlugins(workspace: WorkspaceInfo): Promise<void> {
    if (workspace.workspaceType !== "local") return;
    await prepareEnterpriseSkills(this.#config, workspace);
    await reconcilePluginPackagesForWorkspace({
      serverConfig: this.#config,
      workspaceId: workspace.id,
      workspaceRoot: workspace.path,
      engineId: workspace.engineId?.trim() || DEFAULT_ENGINE_ID,
    });
    await prepareStandaloneSkills(this.#config, workspace);
    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      await this.#codexHarness.forWorkspace(workspace).call("skills/list", { cwds: [workspace.path], forceReload: true });
    }
  }

  /** Native workers share their bound conversation's artifact ownership. */
  async artifactOwnerSessionId(workspace: WorkspaceInfo, sessionId: string): Promise<string> {
    await assertResourceWritable(this.#config, workspace.id, sessionId);
    const engineWorkspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, {
      codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness,
    }).catch(() => null);
    if (!engineWorkspace) return sessionId;
    const engineId = engineWorkspace.engineId ?? DEFAULT_ENGINE_ID;
    let currentId = sessionId;
    const visited = new Set<string>();
    for (let depth = 0; depth < 16 && !visited.has(currentId); depth++) {
      visited.add(currentId);
      const binding = await readProjectSessionWorkItem(this.#config, workspace.id, currentId);
      if (binding?.execution) return binding.execution.runtime.engineId === engineId ? currentId : sessionId;
      if (engineId === CODEX_HARNESS_ENGINE_ID) {
        const { thread } = await this.#codexHarness.forWorkspace(engineWorkspace).call<{ thread?: CodexThread }>("thread/read", { threadId: currentId, includeTurns: false }).catch(() => ({ thread: undefined }));
        if (!thread?.parentThreadId || !workspacePathMatches(thread.cwd, workspace.path)
          || !isRecord(thread.source) || !isRecord(thread.source.subAgent)) return sessionId;
        currentId = thread.parentThreadId;
      } else if (engineId === DEFAULT_ENGINE_ID) {
        const client = this.#createWorkspaceOpencodeClient(this.#config, engineWorkspace);
        const child = await client.session.get({ sessionID: currentId })
          .then(result => buildSession(this.#unwrapOpencodeResult(result, `/session/${encodeURIComponent(currentId)}`))).catch(() => null);
        if (!child?.parentID || !workspacePathMatches(child.directory ?? undefined, workspace.path)) return sessionId;
        const messages = await client.session.messages({ sessionID: child.parentID, limit: 100 })
          .then(result => buildSessionMessages(this.#unwrapOpencodeResult(result, `/session/${encodeURIComponent(child.parentID!)}/message`))).catch(() => []);
        const delegated = messages.some(message => message.parts.some(part => {
          if (part.type !== "tool" || part.tool !== "task" || !isRecord(part.state)) return false;
          const metadata = isRecord(part.state.metadata) ? part.state.metadata : {};
          const input = isRecord(part.state.input) ? part.state.input : {};
          return metadata.sessionId === currentId || input.task_id === currentId;
        }));
        if (!delegated) return sessionId;
        currentId = child.parentID;
      } else return sessionId;
    }
    return sessionId;
  }

  async create(
    workspace: WorkspaceInfo,
    title?: string,
    model?: WorkspaceSessionModel,
    engineId = workspace.engineId?.trim() || DEFAULT_ENGINE_ID,
  ): Promise<SessionInfoReadModel> {
    const release = await beginResourceOperation(this.#config, workspace.id);
    try { return await this.#create(workspace, title, model, engineId); } finally { release(); }
  }
  async #create(workspace: WorkspaceInfo, title: string | undefined, model: WorkspaceSessionModel | undefined, engineId: string): Promise<SessionInfoReadModel> {
    await assertResourceWritable(this.#config, workspace.id);
    workspace = { ...workspace, engineId };
    await this.preparePlugins(workspace);
    const created = await this.#createSession(workspace, title, model);
    await rememberResourceSummaries(this.#config, workspace.id, [{ ...created, engineId }]);
    await bindConversationSession(this.#config, workspace, created.id, {
      title: created.title || "New conversation",
      engineId,
    });
    return { ...created, engineId };
  }

  async #createSession(
    workspace: WorkspaceInfo,
    title?: string,
    model?: WorkspaceSessionModel,
  ): Promise<SessionInfoReadModel> {
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      const runtime = this.#deepseekHarness.forWorkspace(workspace);
      const result = await runtime.call<{ sessionId: string; agentPreset?: string }>("session.create", {
        cwd: workspace.path,
      });
      const sessionId = result.sessionId?.trim();
      if (!sessionId) {
        throw new ApiError(502, "deepseek_harness_invalid_response", "DeepSeek Harness returned an invalid session");
      }
      if (title) await runtime.call("session.rename", { sessionId, title });
      const now = Date.now();
      return {
        id: sessionId,
        title: title || "New conversation",
        slug: sessionId,
        directory: workspace.path,
        time: { created: now, updated: now },
        dsh: {
          running: false,
          blank: true,
          ...(result.agentPreset ? { agentPreset: result.agentPreset } : {}),
        },
      };
    }

    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      const runtime = this.#codexHarness.forWorkspace(workspace);
      const result = await runtime.startThread<{
        thread?: CodexThread;
        model?: string;
        modelProvider?: string;
      }>({
        cwd: workspace.path,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        ...(model ? {
          modelProvider: codexHarnessRuntimeProviderId(model.providerID),
          model: model.modelID,
          allowProviderModelFallback: false,
        } : {}),
      });
      if (!result.thread?.id) {
        throw new ApiError(502, "codex_harness_invalid_response", "Codex Harness returned an invalid thread");
      }
      this.#rememberFreshCodexThread(this.#codexThreadKey(workspace.id, result.thread.id), {
        providerID: model?.providerID || result.modelProvider?.trim() || "",
        modelID: result.model?.trim() || model?.modelID || "",
      });
      if (title) await runtime.call("thread/name/set", { threadId: result.thread.id, name: title });
      return mapCodexThread({ ...result.thread, ...(title ? { name: title } : {}) });
    }

    const opencode = this.#createWorkspaceOpencodeClient(this.#config, workspace);
    return buildSession(
      this.#unwrapOpencodeResult(
        await opencode.session.create({ directory: workspace.path, title }),
        "/session",
      ),
    );
  }

  async prompt(
    workspace: WorkspaceInfo,
    sessionId: string,
    input: WorkspaceSessionPromptInput,
  ): Promise<string> {
    const release = await beginResourceOperation(this.#config, workspace.id, sessionId);
    try { return await this.#prompt(workspace, sessionId, input); } finally { release(); }
  }
  async #prompt(workspace: WorkspaceInfo, sessionId: string, input: WorkspaceSessionPromptInput): Promise<string> {
    await assertResourceWritable(this.#config, workspace.id, sessionId);
    workspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, { codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness });
    await this.preparePlugins(workspace);
    const startedAt = Date.now();
    const accept = async (effectiveSessionId = sessionId): Promise<string> => {
      const binding = await readProjectSessionWorkItem(this.#config, workspace.id, sessionId);
      if (binding?.execution) {
        await startProjectSessionExecution(this.#config, workspace.id, binding.title, {
          ...binding.execution,
          sessionId: effectiveSessionId,
        }, { startedAt, ...(effectiveSessionId !== sessionId ? { previousSessionId: sessionId } : {}) });
      }
      return effectiveSessionId;
    };
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      const runtime = this.#deepseekHarness.forWorkspace(workspace);
      if (input.mode) {
        await runtime.call("agentPreset.select", { sessionId, agentPreset: input.mode });
      }
      if (input.model) {
        const directory = input.model.providerID.trim().toLowerCase() === "openai"
          ? await runtime.call<DeepSeekHarnessModelDirectory>("llm.models", {}).catch(() => null)
          : null;
        await runtime.call("session.selectModel", {
          sessionId,
          provider: deepSeekHarnessRuntimeProviderId(
            input.model.providerID,
            input.model.modelID,
            directory,
          ),
          model: input.model.modelID,
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        });
      }
      this.#rememberSessionContext(workspace.id, sessionId);
      await runtime.call("session.prompt", {
        sessionId,
        mode: "queue",
        content: [
          ...(input.system?.trim() ? [deepSeekSystemContent(input.system.trim())] : []),
          { type: "text", text: input.text },
        ],
        clientTimeZone: input.clientTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      return accept();
    }

    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      const runtime = this.#codexHarness.forWorkspace(workspace);
      const freshKey = this.#codexThreadKey(workspace.id, sessionId);
      const fresh = this.#freshCodexThreads.get(freshKey);
      const freshMatchesSelection = Boolean(
        fresh
        && (!input.model || (
          fresh.providerID === input.model.providerID
          && fresh.modelID === input.model.modelID
        )),
      );
      let effectiveSessionId = sessionId;
      if (!freshMatchesSelection) {
        const resumed = await runtime.resumeThread({
          threadId: sessionId,
          cwd: workspace.path,
          ...(input.model ? {
            modelProvider: codexHarnessRuntimeProviderId(input.model.providerID),
            model: input.model.modelID,
          } : {}),
        });
        const resumedThread = resumed && typeof resumed === "object" && "thread" in resumed
          && typeof resumed.thread === "object" && resumed.thread !== null
          ? resumed.thread
          : null;
        if (resumedThread && "id" in resumedThread && typeof resumedThread.id === "string" && resumedThread.id.trim()) {
          effectiveSessionId = resumedThread.id.trim();
        }
      }
      const additionalContext = buildCodexHarnessAdditionalContext(input.system, [], input.model);
      this.#rememberSessionContext(workspace.id, effectiveSessionId);
      await runtime.call("turn/start", {
        threadId: effectiveSessionId,
        input: [{ type: "text", text: input.text, text_elements: [] }],
        ...(additionalContext ? { additionalContext } : {}),
        // The selected provider/model was applied by thread/start or
        // thread/resume. Do not send a model-only turn override that can fall
        // back to Codex's default provider.
        ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
      });
      this.#freshCodexThreads.delete(freshKey);
      return accept(effectiveSessionId);
    }

    await this.#prepareOpencodePrompt?.(workspace);
    const opencode = this.#createWorkspaceOpencodeClient(this.#config, workspace);
    this.#rememberSessionContext(workspace.id, sessionId);
    this.#unwrapOpencodeResult(
      await opencode.session.promptAsync({
        sessionID: sessionId,
        parts: [{ type: "text", text: input.text }],
        model: input.model,
        agent: input.mode,
        variant: input.reasoningEffort,
        ...(input.system?.trim() ? { system: input.system.trim() } : {}),
      }),
      `/session/${encodeURIComponent(sessionId)}/prompt_async`,
    );
    return accept();
  }

  async #readCompletion(
    workspace: WorkspaceInfo,
    sessionId: string,
    target: WorkspaceSessionCompletionTarget = {},
  ): Promise<WorkspaceSessionCompletion | null> {
    workspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, { codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness });
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      const snapshot = await readDeepSeekHarnessSnapshot(
        this.#deepseekHarness.forWorkspace(workspace),
        workspace,
        sessionId,
      );
      return deepSeekHarnessCompletion(snapshot.history, target);
    }

    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      const runtime = this.#codexHarness.forWorkspace(workspace);
      const thread = await readCodexHarnessThread(runtime, sessionId);
      if (!codexHarnessCompletion(thread, target)) return null;
      // History is paginated separately from live metadata. Recheck the
      // native status after reading a terminal turn so an earlier idle read
      // cannot settle a run that became active during history hydration.
      const latest = await runtime.call<{ thread?: CodexThread }>("thread/read", { threadId: sessionId, includeTurns: false });
      if (!latest.thread) return null;
      return codexHarnessCompletion({ ...thread, status: latest.thread.status }, target);
    }

    const opencode = this.#createWorkspaceOpencodeClient(this.#config, workspace);
    const [messages, statuses] = await Promise.all([
      opencode.session.messages({ sessionID: sessionId }).then((result) => buildSessionMessages(
        this.#unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}/message`),
      )),
      opencode.session.status().then((result) => buildSessionStatuses(
        this.#unwrapOpencodeResult(result, "/session/status"),
      )),
    ]);
    return opencodeCompletion({ sessionId, messages, statuses, startedAt: target.startedAt });
  }

  async waitForCompletion(
    workspace: WorkspaceInfo,
    sessionId: string,
    options: { signal?: AbortSignal; pollMs?: number; timeoutMs?: number } & WorkspaceSessionCompletionTarget = {},
  ): Promise<WorkspaceSessionCompletion> {
    const pollMs = Math.min(Math.max(options.pollMs ?? 2_000, 250), 30_000);
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30 * 60_000, 1_000), 24 * 60 * 60_000);
    const candidate = options.startedAt === undefined ? null : await readEnhancementExecution(workspace, sessionId);
    const enhancement = candidate && !candidate.finished && options.startedAt !== undefined
      && Math.abs(candidate.createdAt - options.startedAt) < 60_000 ? candidate : null;
    const deadline = Math.min(Date.now() + timeoutMs, enhancement ? enhancement.createdAt + enhancement.maxElapsedMs : Infinity);
    let lastReadError: unknown;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Automatic task monitoring stopped");
      try {
        const completion = await this.#readCompletion(workspace, sessionId, options);
        if (completion) {
          if (enhancement) await finishEnhancementExecution(workspace, sessionId, enhancement.requestPath);
          return completion;
        }
        lastReadError = undefined;
      } catch (error) {
        lastReadError = error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(pollMs, remaining), undefined, { signal: options.signal });
    }
    if (enhancement && Date.now() >= enhancement.createdAt + enhancement.maxElapsedMs) {
      if (options.signal?.aborted) throw options.signal.reason;
      const current = await readEnhancementExecution(workspace, sessionId);
      if (current?.requestPath !== enhancement.requestPath) throw new Error("Enhancement run superseded");
      const completed = await this.#readCompletion(workspace, sessionId, options);
      if (completed) {
        await finishEnhancementExecution(workspace, sessionId, enhancement.requestPath);
        return completed;
      }
      const binding = await readProjectSessionWorkItem(this.#config, workspace.id, sessionId);
      if (binding?.runStartedAt !== options.startedAt) throw new Error("Conversation run superseded");
      if (options.signal?.aborted) throw options.signal.reason;
      workspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, { codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness });
      if (options.signal?.aborted) throw options.signal.reason;
      if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
        const runtime = this.#codexHarness.forWorkspace(workspace);
        const thread = options.turnId ? null : await readCodexHarnessThread(runtime, sessionId);
        const turnId = options.turnId ?? thread?.turns?.at(-1)?.id;
        if (!turnId) throw new Error("AI 编排超时，无法确认正在运行的 turn；草稿已保留，请停止当前任务。");
        if (options.signal?.aborted) throw options.signal.reason;
        await runtime.call("turn/interrupt", { threadId: sessionId, turnId });
      } else if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
        await this.#deepseekHarness.forWorkspace(workspace).call("session.cancel", { sessionId });
      } else {
        this.#unwrapOpencodeResult(await this.#createWorkspaceOpencodeClient(this.#config, workspace).session.abort({ sessionID: sessionId }), `/session/${sessionId}/abort`);
      }
      await finishEnhancementExecution(workspace, sessionId, enhancement.requestPath);
      return { status: "failed", error: "AI 编排达到 10 分钟上限，已停止本轮生成。完整原视频和当前可编辑草稿已保留；请查看未完成的检查项后继续。" };
    }
    const detail = lastReadError ? `: ${errorMessage(lastReadError, "session status unavailable")}` : "";
    throw new Error(`Automatic task did not finish within ${Math.round(timeoutMs / 60_000)} minutes${detail}`);
  }

  async #lifecycle<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#lifecycleOperations.get(workspaceId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.#lifecycleOperations.set(workspaceId, pending);
    try { return await pending; } finally { if (this.#lifecycleOperations.get(workspaceId) === pending) this.#lifecycleOperations.delete(workspaceId); }
  }

  async #summary(workspace: WorkspaceInfo, sessionId: string): Promise<SessionInfoReadModel> {
    let summary: SessionInfoReadModel;
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) summary = await readDeepSeekHarnessSession(this.#deepseekHarness.forWorkspace(workspace), workspace, sessionId);
    else if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) summary = mapCodexThread(await readCodexHarnessThread(this.#codexHarness.forWorkspace(workspace), sessionId));
    else summary = buildSession(this.#unwrapOpencodeResult(await this.#createWorkspaceOpencodeClient(this.#config, workspace).session.get({ sessionID: sessionId }), `/session/${sessionId}`));
    if (!workspacePathMatches(summary.directory ?? undefined, workspace.path)) throw new ApiError(404, "session_not_found", "Session does not belong to this project");
    return { ...summary, engineId: workspace.engineId || DEFAULT_ENGINE_ID };
  }

  async #stop(workspace: WorkspaceInfo, sessionId: string, onlyIfStarted = false) {
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      if (onlyIfStarted && !this.#deepseekHarness.hasWorkspaceRuntime(workspace.id)) return;
      const runtime = this.#deepseekHarness.forWorkspace(workspace);
      const sessions = await runtime.call<{ items: DeepSeekHarnessSummary[] }>("session.list", {});
      if (sessions.items.find(session => session.sessionId === sessionId)?.running) await runtime.call("session.cancel", { sessionId });
    } else if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      if (onlyIfStarted && !this.#codexHarness.hasWorkspaceRuntime(workspace.id)) return;
      const runtime = this.#codexHarness.forWorkspace(workspace);
      const thread = await readCodexHarnessThread(runtime, sessionId).catch(error => { if (nativeSessionMissing(error)) return null; throw error; });
      if (!thread) return;
      const turn = thread.turns?.at(-1);
      if (turn?.status === "inProgress") await runtime.call("turn/interrupt", { threadId: sessionId, turnId: turn.id });
    } else {
      this.#unwrapOpencodeResult(await this.#createWorkspaceOpencodeClient(this.#config, workspace).session.abort({ sessionID: sessionId }), `/session/${sessionId}/abort`);
    }
  }

  async delete(workspace: WorkspaceInfo, sessionId: string, deleteFiles = false): Promise<void> {
    return this.#lifecycle(workspace.id, async () => {
      let pending = await readResourceLifecycle(this.#config, workspace.id, sessionId);
      if (pending?.deleting === 2) return;
      if (pending?.deleting && Boolean(pending.deleteFiles) !== deleteFiles) throw new ApiError(409, "deletion_scope_conflict", "请按原来的删除范围重试，等待当前清理完成。");
      workspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, { codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness });
      const engineId = workspace.engineId || DEFAULT_ENGINE_ID;
      if (!pending?.deleting) {
        const summary = pending?.summary ?? await this.#summary(workspace, sessionId);
        const cleanup = deleteFiles ? await sessionArtifactCleanup(this.#config, workspace, sessionId) : { paths: [], retainedPaths: [] };
        for (const path of cleanup.paths) await verifyCleanupPath(workspace.path, join(workspace.path, path));
        await beginResourceDeletion(this.#config, workspace.id, sessionId, engineId, cleanup, { ...summary, engineId }, deleteFiles);
        pending = await readResourceLifecycle(this.#config, workspace.id, sessionId);
      }
      await releaseOwnedVideoJobs(this.#config, workspace.id, sessionId);
      await releaseResourceOperations(this.#config, workspace.id, sessionId);
      await this.#releaseSessionObservers?.(workspace.id, sessionId);
      if (!pending?.engineDeleted) {
        try {
          await this.#stop(workspace, sessionId, !deleteFiles);
          if (!deleteFiles) {
            // Close an idle runtime without changing native history or files.
            if (engineId === DEEPSEEK_HARNESS_ENGINE_ID && this.#deepseekHarness.hasWorkspaceRuntime(workspace.id)) {
              const sessions = await this.#deepseekHarness.forWorkspace(workspace).call<{ items: DeepSeekHarnessSummary[] }>("session.list", {});
              if (!sessions.items.some(session => session.running)) await this.#deepseekHarness.closeWorkspace(workspace.id);
            } else if (engineId === CODEX_HARNESS_ENGINE_ID && this.#codexHarness.hasWorkspaceRuntime(workspace.id)) {
              const runtime = this.#codexHarness.forWorkspace(workspace);
              const loaded = await runtime.call<{ data?: string[] }>("thread/loaded/list", {});
              if (Array.isArray(loaded.data)) {
                const threads = await Promise.all(loaded.data.map(id => readCodexHarnessThread(runtime, id)));
                if (!threads.some(thread => thread.turns?.at(-1)?.status === "inProgress")) await this.#codexHarness.closeWorkspace(workspace.id);
              }
            }
          } else if (engineId === DEEPSEEK_HARNESS_ENGINE_ID) await this.#deepseekHarness.deleteSession(workspace, sessionId);
          else if (engineId === CODEX_HARNESS_ENGINE_ID) {
            this.#freshCodexThreads.delete(this.#codexThreadKey(workspace.id, sessionId));
            await this.#codexHarness.forWorkspace(workspace).call("thread/delete", { threadId: sessionId });
          } else this.#unwrapOpencodeResult(await this.#createWorkspaceOpencodeClient(this.#config, workspace).session.delete({ sessionID: sessionId }), `/session/${sessionId}`);
        } catch (error) {
          // Ownership and cleanup were recorded before the native delete. A lost
          // response may leave an already-deleted native session on the next retry.
          if (!nativeSessionMissing(error)) throw error;
        }
        if (deleteFiles) await markResourceEngineDeleted(this.#config, workspace.id, sessionId);
      }
      if (deleteFiles) {
        if (pending?.cleanup) await removeOwnedFiles(workspace.path, pending.cleanup);
        await deleteSessionArtifactRecords(this.#config, workspace.id, sessionId);
        await deleteResourceRecords(this.#config, workspace.id, sessionId);
      }
      const binding = await readProjectSessionWorkItem(this.#config, workspace.id, sessionId);
      if (binding) await deleteWorkItem(this.#config, workspace.id, binding.id, binding.version);
      this.#freshCodexThreads.delete(this.#codexThreadKey(workspace.id, sessionId));
      await forgetResourceLifecycle(this.#config, workspace.id, sessionId);
    });
  }

  async deleteWorkspace(workspace: WorkspaceInfo, deleteFiles = false) {
    return this.#lifecycle(workspace.id, async () => {
      if (deleteFiles) await validateProjectDeletion(this.#config, workspace);
      const pending = await readResourceLifecycle(this.#config, workspace.id);
      if (pending?.deleting === 2) return;
      if (pending?.deleting && Boolean(pending.deleteFiles) !== deleteFiles) throw new ApiError(409, "deletion_scope_conflict", "请按原来的删除范围重试，等待当前清理完成。");
      await beginResourceDeletion(this.#config, workspace.id, "", workspace.engineId || DEFAULT_ENGINE_ID, { paths: deleteFiles ? ["."] : [], retainedPaths: [] }, undefined, deleteFiles);
      await releaseResourceOperations(this.#config, workspace.id);
      await this.#releaseSessionObservers?.(workspace.id);
      await releaseOwnedVideoJobs(this.#config, workspace.id);
      if (!deleteFiles) {
        await Promise.all([this.#codexHarness.closeWorkspace(workspace.id), this.#deepseekHarness.closeWorkspace(workspace.id)]);
        const engines = new Set([workspace.engineId || DEFAULT_ENGINE_ID, ...await listBoundSessionEngines(this.#config, workspace.id)]);
        if (engines.has(DEFAULT_ENGINE_ID)) this.#unwrapOpencodeResult(await this.#createWorkspaceOpencodeClient(this.#config, workspace).instance.dispose({ directory: workspace.path }), "/instance/dispose");
      } else if (!pending?.engineDeleted) {
        const engines = new Set([workspace.engineId || DEFAULT_ENGINE_ID, ...await listBoundSessionEngines(this.#config, workspace.id), ...(await listResourceLifecycles(this.#config, workspace.id)).map(row => row.engineId)]);
        const client = this.#createWorkspaceOpencodeClient(this.#config, workspace);
        if (engines.has(DEFAULT_ENGINE_ID)) {
          let start = 0;
          for (;;) {
            const page = buildSessionList(this.#unwrapOpencodeResult(await client.session.list({ limit: 100, start }), "/session"));
            if (!page.length) break;
            const sessions = page.filter(session => workspacePathMatches(session.directory ?? undefined, workspace.path));
            for (const session of sessions) {
              this.#unwrapOpencodeResult(await client.session.abort({ sessionID: session.id }), `/session/${session.id}/abort`);
              this.#unwrapOpencodeResult(await client.session.delete({ sessionID: session.id }), `/session/${session.id}`);
            }
            if (!sessions.length) { if (page.length < 100) break; start += page.length; }
          }
          this.#unwrapOpencodeResult(await client.instance.dispose({ directory: workspace.path }), "/instance/dispose");
        }
        await this.#codexHarness.deleteWorkspaceData(workspace.id);
        if (engines.has(DEEPSEEK_HARNESS_ENGINE_ID)) await this.#deepseekHarness.deleteWorkspaceData({ ...workspace, engineId: DEEPSEEK_HARNESS_ENGINE_ID },
          (await listResourceLifecycles(this.#config, workspace.id)).filter(row => row.engineId === DEEPSEEK_HARNESS_ENGINE_ID).map(row => row.sessionId).filter(Boolean));
        await markResourceEngineDeleted(this.#config, workspace.id, "");
      }
      if (deleteFiles) {
        await removeOwnedFiles(workspace.path, { paths: ["."], retainedPaths: [] }, true);
        await deleteWorkspacePluginServiceData(this.#config, workspace.id);
        await deleteSessionArtifactRecords(this.#config, workspace.id);
        await deleteResourceRecords(this.#config, workspace.id);
      }
      await deleteWorkspaceWorkState(this.#config, workspace.id);
      await forgetResourceLifecycle(this.#config, workspace.id);
      this.#sessionContextHints.delete(workspace.id);
      for (const key of this.#freshCodexThreads.keys()) if (key.startsWith(`${workspace.id}\u0000`)) this.#freshCodexThreads.delete(key);
    });
  }
}

function nativeSessionMissing(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || (isRecord(error.details) && error.details.status === 404))
    || error instanceof StdioJsonRpcError && /^(?:thread not found:|session not found(?::|$)|no rollout found for thread id\b)/i.test(error.message);
}
