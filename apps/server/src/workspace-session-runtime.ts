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
  workspacePathMatches,
  type DeepSeekHarnessSummary,
  type DeepSeekHarnessHistory,
} from "./deepseek-harness-session-read-model.js";
import type { DeepSeekHarnessRuntimePool } from "./deepseek-harness-runtime.js";
import { ApiError } from "./errors.js";
import { reconcilePluginPackagesForWorkspace } from "./plugin-package-lifecycle.js";
import {
  buildSession,
  buildSessionMessages,
  buildSessionStatuses,
  type SessionInfoReadModel,
  type SessionMessageReadModel,
  type SessionStatusReadModel,
} from "./session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { bindConversationSession, deleteWorkItem, listBoundSessionEngines, readProjectSessionWorkItem } from "./work-items.js";

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
  }) {
    this.#config = input.config;
    this.#createWorkspaceOpencodeClient = input.createWorkspaceOpencodeClient;
    this.#unwrapOpencodeResult = input.unwrapOpencodeResult;
    this.#deepseekHarness = input.deepseekHarness;
    this.#codexHarness = input.codexHarness;
    this.#prepareOpencodePrompt = input.prepareOpencodePrompt;
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
    await reconcilePluginPackagesForWorkspace({
      serverConfig: this.#config,
      workspaceId: workspace.id,
      workspaceRoot: workspace.path,
      engineId: workspace.engineId?.trim() || DEFAULT_ENGINE_ID,
    });
    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      await this.#codexHarness.forWorkspace(workspace).call("skills/list", { cwds: [workspace.path], forceReload: true });
    }
  }

  /** Native workers share their bound conversation's artifact ownership. */
  async artifactOwnerSessionId(workspace: WorkspaceInfo, sessionId: string): Promise<string> {
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
    workspace = { ...workspace, engineId };
    await this.preparePlugins(workspace);
    const created = await this.#createSession(workspace, title, model);
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
    workspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, { codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness });
    await this.preparePlugins(workspace);
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
      return sessionId;
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
      if (effectiveSessionId !== sessionId) {
        await bindConversationSession(this.#config, workspace, effectiveSessionId, {
          title: "New conversation",
          engineId: CODEX_HARNESS_ENGINE_ID,
          parentSessionId: sessionId,
        });
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
      return effectiveSessionId;
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
    return sessionId;
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
    const deadline = Date.now() + timeoutMs;
    let lastReadError: unknown;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Automatic task monitoring stopped");
      try {
        const completion = await this.#readCompletion(workspace, sessionId, options);
        if (completion) return completion;
        lastReadError = undefined;
      } catch (error) {
        lastReadError = error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(pollMs, remaining), undefined, { signal: options.signal });
    }
    const detail = lastReadError ? `: ${errorMessage(lastReadError, "session status unavailable")}` : "";
    throw new Error(`Automatic task did not finish within ${Math.round(timeoutMs / 60_000)} minutes${detail}`);
  }

  async delete(workspace: WorkspaceInfo, sessionId: string): Promise<void> {
    workspace = await resolveWorkspaceSession(this.#config, workspace, sessionId, { codexHarness: this.#codexHarness, deepseekHarness: this.#deepseekHarness });
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      throw new ApiError(
        501,
        "session_delete_unsupported",
        "DeepSeek Harness supports session archiving but not permanent deletion",
      );
    }

    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      this.#freshCodexThreads.delete(this.#codexThreadKey(workspace.id, sessionId));
      await this.#codexHarness.forWorkspace(workspace).call("thread/delete", { threadId: sessionId });
    } else {
      const opencode = this.#createWorkspaceOpencodeClient(this.#config, workspace);
      this.#unwrapOpencodeResult(
        await opencode.session.delete({ sessionID: sessionId }),
        `/session/${encodeURIComponent(sessionId)}`,
      );
    }
    const binding = await readProjectSessionWorkItem(this.#config, workspace.id, sessionId);
    if (binding) await deleteWorkItem(this.#config, workspace.id, binding.id, binding.version);
  }
}
