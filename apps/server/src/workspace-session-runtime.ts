import { setTimeout as delay } from "node:timers/promises";
import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  CODEX_HARNESS_ENGINE_ID,
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
  type DeepSeekHarnessHistory,
} from "./deepseek-harness-session-read-model.js";
import type { DeepSeekHarnessRuntimePool } from "./deepseek-harness-runtime.js";
import { ApiError } from "./errors.js";
import {
  buildSession,
  buildSessionMessages,
  buildSessionStatuses,
  type SessionInfoReadModel,
  type SessionMessageReadModel,
  type SessionStatusReadModel,
} from "./session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

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
): WorkspaceSessionCompletion | null {
  for (let index = history.events.length - 1; index >= 0; index -= 1) {
    const event = history.events[index]?.event;
    if (event?.type !== "turn/end") continue;
    const data = isRecord(event.data) ? event.data : null;
    const reason = data && isRecord(data.reason) ? data.reason : null;
    if (reason?.kind === "error") {
      return {
        status: "failed",
        error: errorMessage(reason.error, "DeepSeek Harness task failed"),
      };
    }
    return { status: "done" };
  }
  return null;
}

export function codexHarnessCompletion(
  thread: CodexThread,
): WorkspaceSessionCompletion | null {
  const turn = thread.turns?.at(-1);
  if (!turn) return null;
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
}): WorkspaceSessionCompletion | null {
  const status = input.statuses[input.sessionId];
  if (status && status.type !== "idle") return null;
  const assistant = [...input.messages].reverse().find((message) => message.info.role === "assistant");
  if (!assistant) return null;
  const failure = isRecord(assistant.info) ? assistant.info.error : undefined;
  return failure
    ? { status: "failed", error: errorMessage(failure, "OpenCode task failed") }
    : { status: "done" };
}

export function buildCodexHarnessAdditionalContext(
  system: unknown,
  pluginInstructions: readonly string[],
): Record<string, { value: string; kind: "application" }> | undefined {
  const context: Record<string, { value: string; kind: "application" }> = {};
  if (typeof system === "string" && system.trim()) {
    context["ipollowork.runtime"] = { value: system.trim(), kind: "application" };
  }
  const pluginText = pluginInstructions.map((instruction) => instruction.trim()).filter(Boolean).join("\n\n");
  if (pluginText) {
    context["ipollowork.plugins"] = { value: pluginText, kind: "application" };
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
  readonly #freshCodexThreads = new Map<string, WorkspaceSessionModel>();

  constructor(input: {
    config: ServerConfig;
    createWorkspaceOpencodeClient: (
      config: ServerConfig,
      workspace: WorkspaceInfo,
    ) => WorkspaceOpencodeClient;
    unwrapOpencodeResult: UnwrapOpencodeResult;
    deepseekHarness: DeepSeekHarnessRuntimePool;
    codexHarness: CodexHarnessRuntimePool;
  }) {
    this.#config = input.config;
    this.#createWorkspaceOpencodeClient = input.createWorkspaceOpencodeClient;
    this.#unwrapOpencodeResult = input.unwrapOpencodeResult;
    this.#deepseekHarness = input.deepseekHarness;
    this.#codexHarness = input.codexHarness;
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

  async create(
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
      const additionalContext = buildCodexHarnessAdditionalContext(input.system, []);
      await runtime.call("turn/start", {
        threadId: effectiveSessionId,
        input: [{ type: "text", text: input.text, text_elements: [] }],
        ...(additionalContext ? { additionalContext } : {}),
        ...(input.model ? { model: input.model.modelID } : {}),
        ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
      });
      this.#freshCodexThreads.delete(freshKey);
      return effectiveSessionId;
    }

    const opencode = this.#createWorkspaceOpencodeClient(this.#config, workspace);
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
  ): Promise<WorkspaceSessionCompletion | null> {
    if (workspace.engineId === DEEPSEEK_HARNESS_ENGINE_ID) {
      const snapshot = await readDeepSeekHarnessSnapshot(
        this.#deepseekHarness.forWorkspace(workspace),
        workspace,
        sessionId,
      );
      return deepSeekHarnessCompletion(snapshot.history);
    }

    if (workspace.engineId === CODEX_HARNESS_ENGINE_ID) {
      const thread = await readCodexHarnessThread(this.#codexHarness.forWorkspace(workspace), sessionId);
      return codexHarnessCompletion(thread);
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
    return opencodeCompletion({ sessionId, messages, statuses });
  }

  async waitForCompletion(
    workspace: WorkspaceInfo,
    sessionId: string,
    options: { signal?: AbortSignal; pollMs?: number; timeoutMs?: number } = {},
  ): Promise<WorkspaceSessionCompletion> {
    const pollMs = Math.min(Math.max(options.pollMs ?? 2_000, 250), 30_000);
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30 * 60_000, 1_000), 24 * 60 * 60_000);
    const deadline = Date.now() + timeoutMs;
    let lastReadError: unknown;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Automatic task monitoring stopped");
      try {
        const completion = await this.#readCompletion(workspace, sessionId);
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
      return;
    }

    const opencode = this.#createWorkspaceOpencodeClient(this.#config, workspace);
    this.#unwrapOpencodeResult(
      await opencode.session.delete({ sessionID: sessionId }),
      `/session/${encodeURIComponent(sessionId)}`,
    );
  }
}
