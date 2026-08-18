/**
 * OpenCode engine adapter.
 *
 * Maps the OpenCode **v2** SDK surface onto the server-side `EngineConnection`
 * contract in `./types.ts`. Everything session-scoped goes through
 * `client.v2.session.*`; the two operations v2 does not expose (permanent delete and
 * title update) fall back to the classic `client.session.*` endpoints.
 *
 * The event translation lives in the pure `mapOpencodeEvent` below so it can be tested
 * without a live OpenCode process, mirroring how the browser adapter splits
 * `opencode-conversation-engine.ts` from `opencode-conversation-mapper.ts`.
 */

import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import type { WorkspaceInfo } from "../../types.js";
import type {
  EngineAdapter,
  EngineCapabilities,
  EngineConnection,
  EngineEvent,
  EngineMessage,
  EngineMessagePart,
  EnginePermission,
  EnginePromptInput,
  EngineQuestion,
  EngineQuestionInfo,
  EngineSession,
  EngineSessionStatus,
  EngineSubscribeInput,
} from "./types.js";

export type OpencodeEngineClient = ReturnType<typeof createOpencodeClient>;

type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response: Response };

export type UnwrapOpencodeResult = <T, E>(result: OpencodeClientResult<T, E>, path: string) => NonNullable<T>;

export interface OpencodeEngineAdapterDeps {
  /** Per-workspace client factory. The server injects `createWorkspaceOpencodeClient`. */
  createClient: (workspace: WorkspaceInfo) => OpencodeEngineClient;
  /** The server's `unwrapOpencodeResult`, which turns SDK failures into `ApiError`. */
  unwrap: UnwrapOpencodeResult;
}

export const OPENCODE_ENGINE_CAPABILITIES: EngineCapabilities = {
  streaming: true,
  resumableStreaming: true,
  permissions: true,
  questions: true,
  interrupt: true,
  wait: true,
  // `client.v2.session.prompt` takes only `{sessionID, id?, prompt, delivery?, resume?}`,
  // and `PromptInput` is `{text, files?, agents?}` — there is nowhere to put a per-turn
  // system prompt or a reasoning-effort hint. The classic `session.promptAsync` accepts
  // both, but using it would give up the durable event cursor that makes `?after=`
  // resumption work, which is the more valuable property for a public API.
  // `variant` survives because it rides along on `switchModel`.
  promptOptions: { system: false, reasoningEffort: false, variant: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** The v2 envelope carries `data`; the classic envelope carries `properties`. */
function readEventPayload(event: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(event.data)) return event.data;
  if (isRecord(event.properties)) return event.properties;
  return {};
}

function readDurableSeq(event: Record<string, unknown>): string | undefined {
  const durable = isRecord(event.durable) ? event.durable : undefined;
  if (!durable) return undefined;
  const seq = readNumber(durable.seq);
  return seq === undefined ? undefined : String(seq);
}

/**
 * Flattens the several error envelopes OpenCode uses: the v2 named error
 * (`{name, data:{message}}`), the effect-tagged error (`{_tag, message}`) and the
 * inline session error (`{type:"unknown", message}`).
 */
export function describeOpencodeError(value: unknown): { code?: string; message: string } {
  if (typeof value === "string" && value.length > 0) return { message: value };
  if (!isRecord(value)) return { message: "OpenCode reported an unknown error" };

  const code = readString(value.name) ?? readString(value._tag) ?? readString(value.type);
  const inner = isRecord(value.data) ? value.data : undefined;
  const message = readString(value.message)
    ?? readString(inner?.message)
    ?? code
    ?? "OpenCode reported an unknown error";
  return code ? { code, message } : { message };
}

/** Normalizes a v2 permission action into the browser adapter's permission kinds. */
export function opencodePermissionKind(action: string): string {
  if (action === "external_directory" || action.endsWith(".external_directory")) return "external_directory";
  if (action === "file.read") return "read";
  if (action === "file.edit" || action === "file.write") return "edit";
  return action;
}

function mapSessionStatus(value: unknown): EngineSessionStatus {
  if (!isRecord(value)) return { type: "idle" };
  if (value.type === "retry") {
    return {
      type: "retry",
      attempt: readNumber(value.attempt) ?? 0,
      message: readString(value.message) ?? "",
      next: readNumber(value.next) ?? 0,
    };
  }
  return value.type === "idle" ? { type: "idle" } : { type: "busy" };
}

/** Maps either `SessionV2Info` (v2) or the classic `Session` onto `EngineSession`. */
export function mapOpencodeSession(value: unknown): EngineSession | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  if (!id) return null;
  const time = isRecord(value.time) ? value.time : undefined;
  const location = isRecord(value.location) ? value.location : undefined;
  return {
    id,
    title: typeof value.title === "string" ? value.title : "",
    parentId: readString(value.parentID) ?? null,
    directory: readString(value.directory) ?? readString(location?.directory) ?? null,
    createdAt: readNumber(time?.created) ?? null,
    updatedAt: readNumber(time?.updated) ?? null,
    archivedAt: readNumber(time?.archived) ?? null,
  };
}

/** Maps a v2 `PermissionV2Request` or a classic `PermissionRequest`. */
export function mapOpencodePermission(value: unknown, receivedAt: number): EnginePermission | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const sessionId = readString(value.sessionID);
  if (!id || !sessionId) return null;

  const action = readString(value.action);
  if (action !== undefined) {
    const metadata: Record<string, unknown> = { ...(isRecord(value.metadata) ? value.metadata : {}), action };
    const save = readStringArray(value.save);
    if (save.length > 0) metadata.save = save.join(", ");
    if (isRecord(value.source)) {
      metadata.tool = { messageID: value.source.messageID, callID: value.source.callID };
    }
    return {
      id,
      sessionId,
      kind: opencodePermissionKind(action),
      resources: readStringArray(value.resources),
      remember: save,
      metadata,
      receivedAt,
    };
  }

  return {
    id,
    sessionId,
    kind: readString(value.permission) ?? "unknown",
    resources: readStringArray(value.patterns),
    remember: readStringArray(value.always),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    receivedAt,
  };
}

/** Maps a v2 `QuestionV2Request` or a classic `QuestionRequest`. */
export function mapOpencodeQuestion(value: unknown, receivedAt: number): EngineQuestion | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const sessionId = readString(value.sessionID);
  if (!id || !sessionId || !Array.isArray(value.questions)) return null;

  const questions: EngineQuestionInfo[] = [];
  for (const entry of value.questions) {
    if (!isRecord(entry)) continue;
    const question = typeof entry.question === "string" ? entry.question : "";
    const options = Array.isArray(entry.options)
      ? entry.options
        .filter(isRecord)
        .map((option) => ({
          label: typeof option.label === "string" ? option.label : "",
          ...(readString(option.description) ? { description: option.description as string } : {}),
        }))
      : [];
    questions.push({
      ...(readString(entry.header) ? { header: entry.header as string } : {}),
      question,
      options,
      ...(typeof entry.multiple === "boolean" ? { multiple: entry.multiple } : {}),
      ...(typeof entry.custom === "boolean" ? { custom: entry.custom } : {}),
    });
  }

  return { id, sessionId, questions, receivedAt };
}

function mapMessageInfo(value: unknown): EngineMessage | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const role = value.role;
  if (!id || (role !== "user" && role !== "assistant" && role !== "system")) return null;
  const time = isRecord(value.time) ? value.time : undefined;
  return {
    id,
    role,
    parts: [],
    createdAt: readNumber(time?.created) ?? null,
    completedAt: readNumber(time?.completed) ?? null,
  };
}

/**
 * Translates one OpenCode event envelope into the normalized engine event.
 *
 * Returns `null` for every event the public API does not model, which is most of the
 * OpenCode stream (pty, lsp, tui, installation, workspace, ...). The function is pure:
 * `subscribe` layers the call-id → tool-name memory on top of it, because
 * `session.next.tool.success` / `.failed` do not repeat the tool name.
 */
export function mapOpencodeEvent(event: unknown): EngineEvent | null {
  if (!isRecord(event)) return null;
  const type = readString(event.type);
  if (!type) return null;

  const data = readEventPayload(event);
  const seq = readDurableSeq(event);
  const emit = (value: EngineEvent): EngineEvent => (seq === undefined ? value : { ...value, seq });

  const sessionId = readString(data.sessionID);

  switch (type) {
    case "session.created":
    case "session.updated": {
      const session = mapOpencodeSession(data.info);
      if (!session) return null;
      return emit({ type: "session.updated", sessionId: sessionId ?? session.id, session });
    }

    case "session.deleted": {
      const id = sessionId ?? mapOpencodeSession(data.info)?.id;
      return id ? emit({ type: "session.deleted", sessionId: id }) : null;
    }

    case "session.error":
    case "session.next.step.failed": {
      if (!sessionId) return null;
      return emit({ type: "session.error", sessionId, error: describeOpencodeError(data.error) });
    }

    case "session.status": {
      if (!sessionId) return null;
      return emit({ type: "session.status", sessionId, status: mapSessionStatus(data.status) });
    }

    case "session.idle": {
      return sessionId ? emit({ type: "session.idle", sessionId }) : null;
    }

    case "session.next.compaction.started": {
      return sessionId ? emit({ type: "session.compaction", sessionId, running: true }) : null;
    }

    case "session.next.compaction.ended":
    case "session.compacted": {
      return sessionId ? emit({ type: "session.compaction", sessionId, running: false }) : null;
    }

    case "todo.updated": {
      if (!sessionId || !Array.isArray(data.todos)) return null;
      return emit({ type: "todo.updated", sessionId, todos: data.todos });
    }

    case "permission.asked":
    case "permission.v2.asked": {
      const permission = mapOpencodePermission(data, Date.now());
      return permission ? emit({ type: "permission.asked", permission }) : null;
    }

    case "permission.replied":
    case "permission.v2.replied": {
      const requestId = readString(data.requestID);
      if (!sessionId || !requestId) return null;
      return emit({ type: "permission.replied", sessionId, requestId });
    }

    case "question.asked":
    case "question.v2.asked": {
      const question = mapOpencodeQuestion(data, Date.now());
      return question ? emit({ type: "question.asked", question }) : null;
    }

    case "question.replied":
    case "question.rejected":
    case "question.v2.replied":
    case "question.v2.rejected": {
      const requestId = readString(data.requestID);
      if (!sessionId || !requestId) return null;
      return emit({ type: "question.replied", sessionId, requestId });
    }

    case "message.updated": {
      const message = mapMessageInfo(data.info);
      if (!message) return null;
      const id = sessionId ?? readString(isRecord(data.info) ? data.info.sessionID : undefined);
      return id ? emit({ type: "message.upsert", sessionId: id, message }) : null;
    }

    case "message.removed": {
      const messageId = readString(data.messageID);
      if (!sessionId || !messageId) return null;
      return emit({ type: "message.removed", sessionId, messageId });
    }

    case "message.part.updated": {
      const part = isRecord(data.part) ? data.part : undefined;
      const partId = readString(part?.id);
      const messageId = readString(part?.messageID);
      const id = sessionId ?? readString(part?.sessionID);
      if (!part || !partId || !messageId || !id) return null;
      return emit({
        type: "message.part",
        sessionId: id,
        messageId,
        partId,
        part: part as EngineMessagePart,
      });
    }

    case "message.part.delta": {
      const messageId = readString(data.messageID);
      const partId = readString(data.partID);
      const delta = readString(data.delta);
      if (!sessionId || !messageId || !partId || !delta) return null;
      return emit({
        type: "message.delta",
        sessionId,
        messageId,
        partId,
        kind: data.field === "reasoning" ? "reasoning" : "text",
        delta,
      });
    }

    case "session.next.text.delta": {
      const messageId = readString(data.assistantMessageID);
      const partId = readString(data.textID);
      const delta = readString(data.delta);
      if (!sessionId || !messageId || !partId || !delta) return null;
      return emit({ type: "message.delta", sessionId, messageId, partId, kind: "text", delta });
    }

    case "session.next.reasoning.delta": {
      const messageId = readString(data.assistantMessageID);
      const partId = readString(data.reasoningID);
      const delta = readString(data.delta);
      if (!sessionId || !messageId || !partId || !delta) return null;
      return emit({ type: "message.delta", sessionId, messageId, partId, kind: "reasoning", delta });
    }

    case "session.next.tool.called": {
      const messageId = readString(data.assistantMessageID);
      const callId = readString(data.callID);
      const tool = readString(data.tool);
      if (!sessionId || !messageId || !callId || !tool) return null;
      return emit({ type: "tool.called", sessionId, messageId, callId, tool, input: data.input });
    }

    case "session.next.tool.success": {
      const messageId = readString(data.assistantMessageID);
      const callId = readString(data.callID);
      if (!sessionId || !messageId || !callId) return null;
      return emit({
        type: "tool.completed",
        sessionId,
        messageId,
        callId,
        // `session.next.tool.success` omits the tool name; `subscribe` fills it in
        // from the matching `session.next.tool.called`.
        tool: readString(data.tool) ?? "",
        status: "success",
        output: data.result !== undefined ? data.result : data.structured,
      });
    }

    case "session.next.tool.failed": {
      const messageId = readString(data.assistantMessageID);
      const callId = readString(data.callID);
      if (!sessionId || !messageId || !callId) return null;
      return emit({
        type: "tool.completed",
        sessionId,
        messageId,
        callId,
        tool: readString(data.tool) ?? "",
        status: "failed",
        error: describeOpencodeError(data.error).message,
      });
    }

    default:
      return null;
  }
}

/** Builds the v2 `PromptInput` body from the engine-neutral prompt parts. */
export function buildOpencodePromptInput(parts: EnginePromptInput["parts"]) {
  const texts: string[] = [];
  const files: Array<{ uri: string; name?: string }> = [];
  const agents: Array<{ name: string }> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) texts.push(part.text);
      continue;
    }
    if (part.type === "file") {
      files.push({ uri: part.url, ...(part.filename ? { name: part.filename } : {}) });
      continue;
    }
    if (part.type === "agent") agents.push({ name: part.name });
  }

  return {
    text: texts.join("\n\n"),
    ...(files.length > 0 ? { files } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  };
}

function sessionPath(sessionId: string): string {
  return `/session/${encodeURIComponent(sessionId)}`;
}

function createOpencodeEngineConnection(
  deps: OpencodeEngineAdapterDeps,
  workspace: WorkspaceInfo,
): EngineConnection {
  const client = deps.createClient(workspace);
  const unwrap = deps.unwrap;

  /** Throws through `unwrap` when the SDK reported a failure; tolerates 204 bodies. */
  const ensureOk = <T, E>(result: OpencodeClientResult<T, E>, path: string): void => {
    if (result.error !== undefined) unwrap(result, path);
  };

  const readSession = async (sessionId: string): Promise<EngineSession> => {
    const body = unwrap(await client.v2.session.get({ sessionID: sessionId }), sessionPath(sessionId));
    const session = mapOpencodeSession(body.data);
    if (!session) throw new Error(`OpenCode returned an invalid session: ${sessionId}`);
    return session;
  };

  return {
    engineId: DEFAULT_ENGINE_ID,
    capabilities: OPENCODE_ENGINE_CAPABILITIES,

    async createSession(input) {
      const body = unwrap(
        await client.v2.session.create({
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.model ? { model: { id: input.model.modelID, providerID: input.model.providerID } } : {}),
        }),
        "/session",
      );
      const session = mapOpencodeSession(body.data);
      if (!session) throw new Error("OpenCode returned an invalid session");
      if (!input.title) return session;
      // v2 has no title field on create or on the session resource, so the classic
      // `session.update` endpoint is the only way to name a session.
      await this.renameSession(session.id, input.title);
      return { ...session, title: input.title };
    },

    getSession: readSession,

    async deleteSession(sessionId) {
      // `client.v2.session` exposes no delete; `Session2.delete` is the only one.
      ensureOk(await client.session.delete({ sessionID: sessionId }), sessionPath(sessionId));
    },

    async renameSession(sessionId, title) {
      // `client.v2.session` exposes no update; `Session2.update` carries `title`.
      ensureOk(await client.session.update({ sessionID: sessionId, title }), sessionPath(sessionId));
    },

    async prompt(input) {
      const path = `${sessionPath(input.sessionId)}/prompt`;
      if (input.agent) {
        ensureOk(
          await client.v2.session.switchAgent({ sessionID: input.sessionId, agent: input.agent }),
          `${sessionPath(input.sessionId)}/agent`,
        );
      }
      if (input.model) {
        ensureOk(
          await client.v2.session.switchModel({
            sessionID: input.sessionId,
            model: {
              id: input.model.modelID,
              providerID: input.model.providerID,
              ...(input.variant ? { variant: input.variant } : {}),
            },
          }),
          `${sessionPath(input.sessionId)}/model`,
        );
      }

      const body = unwrap(
        await client.v2.session.prompt({
          sessionID: input.sessionId,
          prompt: buildOpencodePromptInput(input.parts),
          ...(input.delivery ? { delivery: input.delivery } : {}),
        }),
        path,
      );
      const messageId = readString(isRecord(body.data) ? body.data.id : undefined);
      return messageId ? { messageId } : {};
    },

    async interrupt(sessionId) {
      // 204 No Content: there is no body to unwrap, only an error to surface.
      ensureOk(await client.v2.session.interrupt({ sessionID: sessionId }), `${sessionPath(sessionId)}/interrupt`);
      return true;
    },

    async wait(sessionId, signal) {
      ensureOk(
        await client.v2.session.wait({ sessionID: sessionId }, signal ? { signal } : {}),
        `${sessionPath(sessionId)}/wait`,
      );
    },

    async listPermissions(sessionId) {
      const body = unwrap(
        await client.v2.session.permission.list({ sessionID: sessionId }),
        `${sessionPath(sessionId)}/permission`,
      );
      const receivedAt = Date.now();
      return (Array.isArray(body.data) ? body.data : [])
        .map((permission) => mapOpencodePermission(permission, receivedAt))
        .filter((permission): permission is EnginePermission => permission !== null);
    },

    async replyPermission(input) {
      ensureOk(
        await client.v2.session.permission.reply({
          sessionID: input.sessionId,
          requestID: input.permissionId,
          reply: input.reply,
        }),
        `${sessionPath(input.sessionId)}/permission/${encodeURIComponent(input.permissionId)}`,
      );
    },

    async listQuestions(sessionId) {
      const body = unwrap(
        await client.v2.session.question.list({ sessionID: sessionId }),
        `${sessionPath(sessionId)}/question`,
      );
      const receivedAt = Date.now();
      return (Array.isArray(body.data) ? body.data : [])
        .map((question) => mapOpencodeQuestion(question, receivedAt))
        .filter((question): question is EngineQuestion => question !== null);
    },

    async replyQuestion(input) {
      ensureOk(
        await client.v2.session.question.reply({
          sessionID: input.sessionId,
          requestID: input.questionId,
          questionV2Reply: { answers: input.answers },
        }),
        `${sessionPath(input.sessionId)}/question/${encodeURIComponent(input.questionId)}`,
      );
    },

    async subscribe(input: EngineSubscribeInput) {
      // `events` returns `{ stream }` (see `core/serverSentEvents.gen.d.ts`), an async
      // generator yielding the already-parsed `data:` payload of each SSE frame.
      const subscription = await client.v2.session.events(
        { sessionID: input.sessionId, ...(input.after ? { after: input.after } : {}) },
        { signal: input.signal },
      );

      // `session.next.tool.success` / `.failed` omit the tool name, so remember it
      // from the matching `.called` event and restore it on completion.
      const toolNames = new Map<string, string>();

      try {
        for await (const raw of subscription.stream) {
          if (input.signal.aborted) return;
          const event = mapOpencodeEvent(raw as unknown);
          if (!event) continue;
          if (event.type === "tool.called") {
            toolNames.set(event.callId, event.tool);
          } else if (event.type === "tool.completed") {
            if (!event.tool) {
              const remembered = toolNames.get(event.callId);
              if (remembered) event.tool = remembered;
            }
            toolNames.delete(event.callId);
          }
          input.onEvent(event);
        }
      } catch (error) {
        if (input.signal.aborted) return;
        throw error;
      }
    },
  };
}

export function createOpencodeEngineAdapter(deps: OpencodeEngineAdapterDeps): EngineAdapter {
  return {
    id: DEFAULT_ENGINE_ID,
    connect(workspace: unknown): EngineConnection {
      return createOpencodeEngineConnection(deps, workspace as WorkspaceInfo);
    },
  };
}
