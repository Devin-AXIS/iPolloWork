import { CODEX_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import { CodexHarnessClient } from "@/app/lib/codex-harness-client";
import type { WorkspaceEngineEvent } from "@/app/lib/workspace-engine-rpc-client";
import { t } from "@/i18n";
import type {
  ConversationAccessMode,
  ConversationEngineAdapter,
  ConversationEngineConnection,
  ConversationMode,
  ConversationPermission,
  ConversationPromptPart,
  ConversationQuestion,
} from "./conversation-engine";
import { waitForConversationIdle } from "./conversation-engine";
import {
  codexNativeRequest,
  createCodexLiveState,
  mapCodexHarnessEvent,
  mapCodexHarnessSnapshot,
} from "./codex-harness-conversation-mapper";

type CodexAccessModeId = "read-only" | "auto" | "granular" | "full-access";
type CodexModeId = "default" | "plan";

function codexModes(): ConversationMode[] {
  return [
    {
      id: "default",
      label: t("composer.work_mode_execute"),
      icon: "execute",
      isDefault: true,
    },
    {
      id: "plan",
      label: t("composer.work_mode_plan"),
      icon: "plan",
    },
  ];
}

function codexMode(value: string | null | undefined): CodexModeId {
  return value === "plan" ? "plan" : "default";
}

function codexAccessModes(): ConversationAccessMode[] {
  return [
    {
      id: "read-only",
      label: t("composer.access_mode_read_only"),
      description: t("composer.access_mode_codex_read_only_description"),
      icon: "read-only",
    },
    {
      id: "auto",
      label: t("composer.access_mode_auto"),
      description: t("composer.access_mode_codex_auto_description"),
      icon: "workspace",
      isDefault: true,
    },
    {
      id: "granular",
      label: t("composer.access_mode_granular"),
      description: t("composer.access_mode_codex_granular_description"),
      icon: "ask",
    },
    {
      id: "full-access",
      label: t("composer.access_mode_full_access"),
      description: t("composer.access_mode_codex_full_access_description"),
      icon: "full-access",
      dangerous: true,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TERMINAL_CODEX_TURN_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "canceled",
]);

function activeCodexTurnId(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.turns)) return null;
  for (let index = value.turns.length - 1; index >= 0; index -= 1) {
    const turn = value.turns[index];
    if (!isRecord(turn) || typeof turn.id !== "string" || !turn.id.trim()) continue;
    const status = typeof turn.status === "string" ? turn.status : "";
    if (!TERMINAL_CODEX_TURN_STATUSES.has(status)) return turn.id.trim();
  }
  return null;
}

function codexTurnIsTerminal(value: unknown, turnId: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.turns)) return false;
  const turn = value.turns.find((candidate) => isRecord(candidate) && candidate.id === turnId);
  if (!isRecord(turn) || typeof turn.status !== "string") return false;
  return TERMINAL_CODEX_TURN_STATUSES.has(turn.status);
}

function supportedCodexModes(value: unknown): Set<CodexModeId> | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  const modes = new Set<CodexModeId>();
  for (const item of value.data) {
    if (!isRecord(item)) continue;
    if (item.mode === "default" || item.mode === "plan") modes.add(item.mode);
  }
  return modes.size > 0 ? modes : null;
}

function textDataUrl(url: string): string | null {
  const match = /^data:(text\/[^;,]+)(;base64)?,([\s\S]*)$/u.exec(url);
  if (!match?.[1] || match[3] === undefined) return null;
  if (!match[2]) return decodeURIComponent(match[3]);
  const bytes = Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function preparePrompt(parts: ConversationPromptPart[]) {
  const input: Array<Record<string, unknown>> = [];
  const applicationInstructions: string[] = [];
  for (const part of parts) {
    if (part.type === "agent") continue;
    if (part.type === "text") {
      if (part.synthetic) {
        if (part.text.trim()) applicationInstructions.push(part.text.trim());
        continue;
      }
      input.push({ type: "text", text: part.text, text_elements: [] });
      continue;
    }
    if (part.mime.startsWith("image/")) {
      input.push({ type: "image", url: part.url });
      continue;
    }
    const text = textDataUrl(part.url);
    input.push({
      type: "text",
      text: text === null
        ? `[Attached file: ${part.filename || "file"}]\n${part.url}`
        : `[Attached file: ${part.filename || "file"}]\n${text}`,
      text_elements: [],
    });
  }
  return { input, applicationInstructions };
}

function eventParams(event: WorkspaceEngineEvent): Record<string, unknown> | null {
  return isRecord(event.params) ? event.params : null;
}

type PermissionReply = "once" | "always" | "reject";

function permissionScope(method: string): string {
  if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") return "shell";
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "edit";
  return method;
}

function permissionResponse(
  native: NonNullable<ReturnType<typeof codexNativeRequest>>,
  reply: PermissionReply,
): Record<string, unknown> {
  if (native.method === "execCommandApproval" || native.method === "applyPatchApproval") {
    return {
      decision: reply === "reject"
        ? { denied: { rejection: "Rejected by user" } }
        : reply === "always"
          ? "approved_for_session"
          : "approved",
    };
  }
  if (native.method === "item/permissions/requestApproval") {
    return {
      permissions: reply === "reject" ? {} : native.params.permissions ?? {},
      scope: reply === "always" ? "session" : "turn",
    };
  }
  return {
    decision: reply === "reject"
      ? "decline"
      : reply === "always"
        ? "acceptForSession"
        : "accept",
  };
}

function codexHarnessConnection(input: {
  serverBaseUrl?: string;
  workspaceId?: string;
  token?: string;
  directory?: string;
}): ConversationEngineConnection {
  if (!input.serverBaseUrl || !input.workspaceId) {
    throw new Error("Codex Harness requires an iPolloWork workspace endpoint");
  }
  const client = new CodexHarnessClient({
    serverBaseUrl: input.serverBaseUrl,
    workspaceId: input.workspaceId,
    token: input.token,
  });
  const permissions = new Map<string, ConversationPermission>();
  const questions = new Map<string, ConversationQuestion>();
  const sessionPermissionScopes = new Map<string, Set<string>>();
  const activeTurns = new Map<string, string>();
  const selectedModes = new Map<string, CodexModeId>();
  const selectedAccessModes = new Map<string, CodexAccessModeId>();
  const liveState = createCodexLiveState();
  let pluginCapabilitiesCache: { at: number; items: Awaited<ReturnType<typeof client.pluginCapabilities>> } | null = null;

  const listPluginCapabilities = async () => {
    if (pluginCapabilitiesCache && Date.now() - pluginCapabilitiesCache.at < 2_000) {
      return pluginCapabilitiesCache.items;
    }
    const items = await client.pluginCapabilities();
    pluginCapabilitiesCache = { at: Date.now(), items };
    return items;
  };

  const replyNativePermission = async (permission: ConversationPermission, reply: PermissionReply) => {
    const native = codexNativeRequest(permission.native);
    if (!native) throw new Error("Codex permission response is no longer available");
    await client.respond(native.rpcId, permissionResponse(native, reply));
  };

  const interruptSession = async (sessionId: string, knownTurnId?: string) => {
    let turnId = knownTurnId ?? activeTurns.get(sessionId);
    if (!turnId) {
      const result = await client.call<{ thread?: unknown }>("thread/read", {
        threadId: sessionId,
        includeTurns: true,
      });
      turnId = activeCodexTurnId(result.thread) ?? undefined;
    }
    if (!turnId) return false;
    await client.call("turn/interrupt", { threadId: sessionId, turnId });
    const stopped = await waitForConversationIdle(async () => {
      const result = await client.call<{ thread?: unknown }>("thread/read", {
        threadId: sessionId,
        includeTurns: true,
      });
      return codexTurnIsTerminal(result.thread, turnId);
    });
    if (stopped && activeTurns.get(sessionId) === turnId) activeTurns.delete(sessionId);
    return stopped;
  };

  return {
    mapSnapshot(snapshot) {
      const mapped = mapCodexHarnessSnapshot(snapshot);
      if (!selectedModes.has(mapped.session.id)) selectedModes.set(mapped.session.id, "default");
      if (!selectedAccessModes.has(mapped.session.id)) selectedAccessModes.set(mapped.session.id, "auto");
      return mapped;
    },
    modeState(session) {
      return { id: selectedModes.get(session.id) ?? "default", mutable: true };
    },
    accessModeState(session) {
      return { id: selectedAccessModes.get(session.id) ?? "auto", mutable: true };
    },
    async subscribe(subscription) {
      for await (const envelope of client.events(subscription.signal)) {
        const params = eventParams(envelope);
        if (envelope.type === "notification" && envelope.method === "turn/started" && params) {
          const threadId = typeof params.threadId === "string" ? params.threadId : null;
          const turn = isRecord(params.turn) ? params.turn : null;
          if (threadId && typeof turn?.id === "string") activeTurns.set(threadId, turn.id);
        }
        if (envelope.type === "notification" && envelope.method === "turn/completed" && params) {
          const threadId = typeof params.threadId === "string" ? params.threadId : null;
          const turn = isRecord(params.turn) ? params.turn : null;
          const turnId = typeof turn?.id === "string" ? turn.id : null;
          if (threadId && (!turnId || activeTurns.get(threadId) === turnId)) activeTurns.delete(threadId);
        }
        if (envelope.type === "notification" && envelope.method === "serverRequest/resolved" && params) {
          const requestId = typeof params.requestId === "string" || typeof params.requestId === "number"
            ? String(params.requestId)
            : null;
          if (requestId) {
            const permission = permissions.get(requestId);
            if (permission) {
              permissions.delete(requestId);
              subscription.onEvent({
                type: "permission.replied",
                sessionId: permission.sessionId,
                requestId,
              });
            }
            const question = questions.get(requestId);
            if (question) {
              questions.delete(requestId);
              subscription.onEvent({
                type: "question.replied",
                sessionId: question.sessionId,
                requestId,
              });
            }
          }
        }
        for (const event of mapCodexHarnessEvent(envelope, liveState)) {
          if (event.type === "session.deleted") sessionPermissionScopes.delete(event.sessionId);
          if (event.type === "permission.asked") {
            const native = codexNativeRequest(event.permission.native);
            const remembered = native
              ? sessionPermissionScopes.get(event.permission.sessionId)?.has(permissionScope(native.method)) === true
              : false;
            if (remembered) {
              try {
                await replyNativePermission(event.permission, "once");
                continue;
              } catch {
                // If the automatic response fails, preserve the request and
                // let the user review it instead of blocking the running turn.
              }
            }
            permissions.set(event.permission.id, event.permission);
          }
          if (event.type === "permission.replied") permissions.delete(event.requestId);
          if (event.type === "question.asked") questions.set(event.question.id, event.question);
          if (event.type === "question.replied") questions.delete(event.requestId);
          subscription.onEvent(event);
        }
      }
    },
    async listPermissions(request) {
      return [...permissions.values()].filter((permission) => permission.sessionId === request.sessionId);
    },
    async replyPermission(request) {
      const native = codexNativeRequest(request.permission.native);
      if (!native) throw new Error("Codex permission response is no longer available");
      await replyNativePermission(request.permission, request.reply);
      if (request.reply === "always") {
        const scopes = sessionPermissionScopes.get(request.permission.sessionId) ?? new Set<string>();
        scopes.add(permissionScope(native.method));
        sessionPermissionScopes.set(request.permission.sessionId, scopes);
      }
      permissions.delete(request.permission.id);
    },
    async listQuestions(request) {
      return [...questions.values()].filter((question) => question.sessionId === request.sessionId);
    },
    async replyQuestion(request) {
      const native = codexNativeRequest(request.question.native);
      const nativeQuestions = native && Array.isArray(native.params.questions) ? native.params.questions : null;
      if (!native || !nativeQuestions) throw new Error("Codex question response is no longer available");
      const answers = Object.fromEntries(nativeQuestions.flatMap((question, index) => (
        isRecord(question) && typeof question.id === "string"
          ? [[question.id, { answers: request.answers[index] ?? [] }] as const]
          : []
      )));
      await client.respond(native.rpcId, { answers });
      questions.delete(request.question.id);
    },
    async create(directory) {
      const result = await client.call<{ thread?: Record<string, unknown> }>("thread/start", {
        cwd: directory || input.directory,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      });
      const thread = result.thread;
      if (!thread || typeof thread.id !== "string") throw new Error("Codex Harness returned an invalid thread");
      selectedModes.set(thread.id, "default");
      selectedAccessModes.set(thread.id, "auto");
      return {
        id: thread.id,
        title: typeof thread.name === "string" ? thread.name : "New conversation",
        slug: thread.id,
        directory: typeof thread.cwd === "string" ? thread.cwd : directory || input.directory,
        time: { created: Date.now(), updated: Date.now() },
      };
    },
    async abort(sessionId) {
      return interruptSession(sessionId);
    },
    async revert(sessionId) {
      const result = await client.call<{ thread?: Record<string, unknown> }>("thread/rollback", {
        threadId: sessionId,
        numTurns: 1,
      });
      return {
        id: sessionId,
        title: typeof result.thread?.name === "string" ? result.thread.name : "New conversation",
        directory: typeof result.thread?.cwd === "string" ? result.thread.cwd : input.directory,
      };
    },
    async fork(request) {
      const result = await client.call<{ thread?: Record<string, unknown> }>("thread/fork", {
        threadId: request.sessionId,
      });
      const thread = result.thread;
      if (!thread || typeof thread.id !== "string") throw new Error("Codex Harness returned an invalid fork");
      selectedModes.set(thread.id, selectedModes.get(request.sessionId) ?? "default");
      selectedAccessModes.set(thread.id, selectedAccessModes.get(request.sessionId) ?? "auto");
      return {
        id: thread.id,
        title: typeof thread.name === "string" ? thread.name : "New conversation",
        parentID: request.sessionId,
        directory: typeof thread.cwd === "string" ? thread.cwd : input.directory,
        time: { created: Date.now(), updated: Date.now() },
      };
    },
    async rename(sessionId, title) {
      await client.call("thread/name/set", { threadId: sessionId, name: title });
    },
    async setArchived(sessionId, archived) {
      await client.call(archived ? "thread/archive" : "thread/unarchive", { threadId: sessionId });
      if (archived) {
        sessionPermissionScopes.delete(sessionId);
        selectedModes.delete(sessionId);
        selectedAccessModes.delete(sessionId);
      }
    },
    async shell(sessionId, command) {
      await client.call("thread/shellCommand", { threadId: sessionId, command });
    },
    async runCommand(request) {
      const mode = codexMode(request.mode);
      const result = await client.prompt({
        threadId: request.sessionId,
        input: [],
        model: request.model,
        mode,
        reasoningEffort: request.reasoningEffort,
        accessMode: selectedAccessModes.get(request.sessionId) ?? "auto",
      }, {
        command: {
          name: request.command,
          ...(request.arguments ? { arguments: request.arguments } : {}),
        },
      });
      if (result.turnId) activeTurns.set(request.sessionId, result.turnId);
      selectedModes.set(request.sessionId, mode);
    },
    async sendPrompt(request) {
      if (request.signal?.aborted) return { sessionId: request.sessionId };
      const mode = codexMode(request.mode);
      const selectedAgents = [...new Set(
        request.parts.flatMap((part) => part.type === "agent" ? [part.name] : []),
      )];
      const prepared = preparePrompt(request.parts);
      const applicationContext = [
        request.system?.trim(),
        ...prepared.applicationInstructions,
      ].filter((value): value is string => Boolean(value)).join("\n\n");
      const requestInterrupt = () => {
        void interruptSession(request.sessionId).catch(() => false);
      };
      request.signal?.addEventListener("abort", requestInterrupt);
      let result: Awaited<ReturnType<typeof client.prompt>>;
      try {
        if (request.signal?.aborted) return { sessionId: request.sessionId };
        result = await client.prompt({
          threadId: request.sessionId,
          ...(request.clientUserMessageId ? { clientUserMessageId: request.clientUserMessageId } : {}),
          input: prepared.input,
          ...(applicationContext ? { system: applicationContext } : {}),
          model: request.model,
          mode,
          reasoningEffort: request.reasoningEffort,
          variant: request.variant,
          accessMode: selectedAccessModes.get(request.sessionId) ?? "auto",
        }, selectedAgents.length ? { agents: selectedAgents } : undefined);
      } finally {
        request.signal?.removeEventListener("abort", requestInterrupt);
      }
      selectedModes.set(request.sessionId, mode);
      const sessionId = typeof result.sessionId === "string" && result.sessionId.trim()
        ? result.sessionId.trim()
        : request.sessionId;
      if (result.turnId) activeTurns.set(sessionId, result.turnId);
      if (request.signal?.aborted && result.turnId) {
        await interruptSession(sessionId, result.turnId);
      }
      selectedModes.set(sessionId, mode);
      selectedAccessModes.set(sessionId, selectedAccessModes.get(request.sessionId) ?? "auto");
      return { sessionId };
    },
    async listCommands() {
      return (await listPluginCapabilities())
        .filter((item) => item.type === "command")
        .map((item) => ({
          id: `${item.pluginId}:${item.resourceId}`,
          name: item.name,
          description: item.description,
          source: "command" as const,
        }));
    },
    async listModes() {
      const native = await client.call<unknown>("collaborationMode/list", {}).catch(() => null);
      const supported = supportedCodexModes(native);
      const modes = codexModes();
      return supported
        ? modes.filter((mode) => supported.has(codexMode(mode.id)))
        : modes;
    },
    async listAccessModes() {
      return codexAccessModes();
    },
    async setAccessMode(request) {
      if (!codexAccessModes().some((mode) => mode.id === request.accessMode)) {
        throw new Error("Unknown Codex permission mode");
      }
      selectedAccessModes.set(request.sessionId, request.accessMode as CodexAccessModeId);
    },
    async listAgents() {
      return (await listPluginCapabilities())
        .filter((item) => item.type === "agent")
        .map((item) => ({ name: item.name, description: item.description, mode: "all" }));
    },
    async searchFiles() {
      return [];
    },
  };
}

export const codexHarnessConversationEngineAdapter: ConversationEngineAdapter = {
  id: CODEX_HARNESS_ENGINE_ID,
  connect: codexHarnessConnection,
};
