import { CODEX_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import { CodexHarnessClient } from "@/app/lib/codex-harness-client";
import type { WorkspaceEngineEvent } from "@/app/lib/workspace-engine-rpc-client";
import type {
  ConversationEngineAdapter,
  ConversationEngineConnection,
  ConversationPermission,
  ConversationPromptPart,
  ConversationQuestion,
} from "./conversation-engine";
import {
  codexNativeRequest,
  createCodexLiveState,
  mapCodexHarnessEvent,
  mapCodexHarnessSnapshot,
} from "./codex-harness-conversation-mapper";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  return {
    mapSnapshot: mapCodexHarnessSnapshot,
    modeState() {
      return { id: "standard", mutable: false };
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
          if (typeof params.threadId === "string") activeTurns.delete(params.threadId);
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
      return {
        id: thread.id,
        title: typeof thread.name === "string" ? thread.name : "New conversation",
        slug: thread.id,
        directory: typeof thread.cwd === "string" ? thread.cwd : directory || input.directory,
        time: { created: Date.now(), updated: Date.now() },
      };
    },
    async abort(sessionId) {
      const turnId = activeTurns.get(sessionId);
      if (!turnId) return false;
      await client.call("turn/interrupt", { threadId: sessionId, turnId });
      return true;
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
      if (archived) sessionPermissionScopes.delete(sessionId);
    },
    async shell(sessionId, command) {
      await client.call("thread/shellCommand", { threadId: sessionId, command });
    },
    async runCommand(request) {
      await client.prompt({
        threadId: request.sessionId,
        input: [],
        model: request.model,
        reasoningEffort: request.reasoningEffort,
      }, {
        command: {
          name: request.command,
          ...(request.arguments ? { arguments: request.arguments } : {}),
        },
      });
    },
    async sendPrompt(request) {
      const selectedAgents = [...new Set(
        request.parts.flatMap((part) => part.type === "agent" ? [part.name] : []),
      )];
      const prepared = preparePrompt(request.parts);
      const applicationContext = [
        request.system?.trim(),
        ...prepared.applicationInstructions,
      ].filter((value): value is string => Boolean(value)).join("\n\n");
      const result = await client.prompt({
        threadId: request.sessionId,
        ...(request.clientUserMessageId ? { clientUserMessageId: request.clientUserMessageId } : {}),
        input: prepared.input,
        ...(applicationContext ? { system: applicationContext } : {}),
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        variant: request.variant,
      }, selectedAgents.length ? { agents: selectedAgents } : undefined);
      return {
        sessionId: typeof result.sessionId === "string" && result.sessionId.trim()
          ? result.sessionId.trim()
          : request.sessionId,
      };
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
      return [{ id: "standard", label: "Standard", icon: "execute", isDefault: true }];
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
